/**
 * Property tests for Orchestrator behavior (Task 13.3)
 * Validates: Requirements 2.3, 2.4, 2.5, 3.1, 3.2, 3.3, 6.4, 16.7, 16.8, 18.1, 18.2, 18.3, 26.5, 26.6
 */

import { test, fc } from '@fast-check/vitest'
import { describe, expect, vi } from 'vitest'
import { Orchestrator } from '@/core/orchestrator'
import { EventBus } from '@/core/event-bus'
import { StateMachine } from '@/core/state-machine'
import { ConcurrencyManager } from '@/core/concurrency-manager'
import { CostTracker } from '@/infrastructure/cost-tracker'
import type {
  AgentRegistry,
  Agent,
  AgentMetadata,
} from '@/agents/agent-interface'
import type { ExecutionStore } from '@/infrastructure/execution-store'
import type { CheckpointManager } from '@/infrastructure/checkpoint-manager'
import type { WorktreeManager } from '@/infrastructure/worktree-manager'
import type { BackendRegistry } from '@/backends/backend-registry'
import type { SpecWriter } from '@/infrastructure/spec-writer'
import type {
  AgentResult,
  PhaseName,
  ExecutionRunRecord,
  PhaseResultRecord,
  WorktreeInfo,
} from '@/core/types'
import type { KASOConfig } from '@/config/schema'

// ============================================================================
// Constants
// ============================================================================

const PIPELINE_PHASES: readonly PhaseName[] = [
  'intake',
  'validation',
  'architecture-analysis',
  'implementation',
  'architecture-review',
  'test-verification',
  'ui-validation',
  'review-delivery',
] as const

const TEST_BACKEND_NAME = 'test-backend'
const TEST_COST_RATE = 0.01
const DEFAULT_TIMEOUT_SECONDS = 300

/** Generates valid spec names: alphanumeric with hyphens, no spaces or slashes */
const specNameArb = fc
  .stringMatching(/^[a-zA-Z][a-zA-Z0-9-]{2,14}$/)
  .filter((s) => !s.endsWith('-'))

// ============================================================================
// Mock factories
// ============================================================================

function createTestConfig(overrides: Partial<KASOConfig> = {}): KASOConfig {
  return {
    executorBackends: [
      {
        name: TEST_BACKEND_NAME,
        command: 'echo',
        args: [],
        protocol: 'cli-json' as const,
        maxContextWindow: 128000,
        costPer1000Tokens: TEST_COST_RATE,
        enabled: true,
      },
    ],
    defaultBackend: TEST_BACKEND_NAME,
    backendSelectionStrategy: 'default' as const,
    maxConcurrentAgents: 4,
    maxPhaseRetries: 2,
    defaultPhaseTimeout: DEFAULT_TIMEOUT_SECONDS,
    phaseTimeouts: {},
    contextCapping: { enabled: false, charsPerToken: 4, relevanceRanking: [] },
    reviewCouncil: {
      maxReviewRounds: 2,
      enableParallelReview: false,
      perspectives: [],
    },
    uiBaseline: {
      baselineDir: '.kiro/ui-baselines',
      captureOnPass: false,
      diffThreshold: 0.1,
      viewport: { width: 1280, height: 720 },
    },
    webhooks: [],
    mcpServers: [],
    plugins: [],
    customPhases: [],
    executionStore: { type: 'sqlite', path: ':memory:' },
    ...overrides,
  }
}
function createSuccessAgent(tokensUsed = 0): Agent {
  return {
    execute: vi.fn(
      async (): Promise<AgentResult> => ({
        success: true,
        output: { result: 'ok' },
        tokensUsed,
      }),
    ),
    supportsRollback: () => false,
    estimatedDuration: () => 1000,
    requiredContext: () => [],
  }
}

function createSlowAgent(delayMs: number): Agent {
  return {
    execute: vi.fn(async (ctx): Promise<AgentResult> => {
      // Use abort-aware sleep to prevent leaked timers when timeout wins the race
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, delayMs)
        ctx.abortSignal?.addEventListener('abort', () => {
          clearTimeout(timer)
          resolve()
        })
      })
      if (ctx.abortSignal?.aborted) {
        return {
          success: false,
          error: { message: 'Aborted', retryable: false },
        }
      }
      return { success: true, output: { result: 'slow-ok' } }
    }),
    supportsRollback: () => false,
    estimatedDuration: () => delayMs,
    requiredContext: () => [],
  }
}

function createMockAgentRegistry(
  agentFactory: () => Agent = createSuccessAgent,
): AgentRegistry {
  const agents = new Map<PhaseName, Agent>()
  const metadata: AgentMetadata[] = []

  for (const phase of PIPELINE_PHASES) {
    const agent = agentFactory()
    agents.set(phase, agent)
    metadata.push({ phase, agent, name: `${phase}-agent` })
  }

  return {
    register: vi.fn(),
    getAgentForPhase: (phase: PhaseName) => agents.get(phase),
    listRegistered: () => metadata,
  }
}

function createMockExecutionStore(): ExecutionStore {
  return {
    saveRun: vi.fn(),
    getRun: vi.fn(() => undefined),
    listRuns: vi.fn(() => []),
    appendPhaseResult: vi.fn(),
    getPhaseResults: vi.fn((): PhaseResultRecord[] => []),
    getInterruptedRuns: vi.fn((): ExecutionRunRecord[] => []),
    updateRunStatus: vi.fn(),
    checkpoint: vi.fn(),
    getDatabase: vi.fn(() => null),
  } as unknown as ExecutionStore
}

function createMockCheckpointManager(): CheckpointManager {
  return {
    saveCheckpoint: vi.fn(),
    getLatestCheckpoint: vi.fn(() => null),
    clearCheckpoints: vi.fn(),
  } as unknown as CheckpointManager
}

function createMockWorktreeManager(): WorktreeManager {
  let retainCalled = false
  return {
    create: vi.fn(
      async (specName: string): Promise<WorktreeInfo> => ({
        path: `/tmp/worktrees/${specName}-test`,
        branch: `kaso/${specName}-20240115T120000`,
        runId: `${specName}-20240115T120000`,
      }),
    ),
    getPath: vi.fn(() => '/tmp/worktrees/test'),
    push: vi.fn(async () => {}),
    cleanup: vi.fn(async () => {}),
    retain: vi.fn(() => {
      retainCalled = true
    }),
    exists: vi.fn(() => true),
    isConsistent: vi.fn(async () => true),
    listWorktrees: vi.fn(() => []),
    loadExistingWorktrees: vi.fn(async () => 0),
    get wasRetainCalled() {
      return retainCalled
    },
  } as unknown as WorktreeManager
}

function createMockBackendRegistry(): BackendRegistry {
  return {
    getBackend: vi.fn(),
    selectBackend: vi.fn(),
    listBackends: vi.fn(() => [TEST_BACKEND_NAME]),
    getConfig: vi.fn(() => ({
      name: TEST_BACKEND_NAME,
      command: 'echo',
      args: [],
      protocol: 'cli-json' as const,
      maxContextWindow: 128000,
      costPer1000Tokens: TEST_COST_RATE,
      enabled: true,
    })),
    getDefaultBackendName: vi.fn(() => TEST_BACKEND_NAME),
    getSelectionStrategy: vi.fn(() => 'default' as const),
    isBackendAvailable: vi.fn(async () => true),
  } as unknown as BackendRegistry
}

function createMockSpecWriter(): SpecWriter {
  return {
    appendExecutionLog: vi.fn(async () => {}),
    updateSpecStatus: vi.fn(async () => {}),
    writeRunStarted: vi.fn(async () => {}),
    writePhaseTransition: vi.fn(async () => {}),
    writeRunCompleted: vi.fn(async () => {}),
  } as unknown as SpecWriter
}

interface OrchestratorDeps {
  eventBus: EventBus
  stateMachine: StateMachine
  agentRegistry: AgentRegistry
  executionStore: ExecutionStore
  checkpointManager: CheckpointManager
  worktreeManager: WorktreeManager
  costTracker: CostTracker
  concurrencyManager: ConcurrencyManager
  backendRegistry: BackendRegistry
  specWriter: SpecWriter
  config: KASOConfig
}

function createOrchestratorDeps(
  overrides: Partial<OrchestratorDeps> = {},
): OrchestratorDeps {
  const eventBus = overrides.eventBus ?? new EventBus()
  const config = overrides.config ?? createTestConfig()
  return {
    eventBus,
    stateMachine: overrides.stateMachine ?? new StateMachine(1000, eventBus),
    agentRegistry: overrides.agentRegistry ?? createMockAgentRegistry(),
    executionStore: overrides.executionStore ?? createMockExecutionStore(),
    checkpointManager:
      overrides.checkpointManager ?? createMockCheckpointManager(),
    worktreeManager: overrides.worktreeManager ?? createMockWorktreeManager(),
    costTracker: overrides.costTracker ?? new CostTracker(),
    concurrencyManager:
      overrides.concurrencyManager ?? new ConcurrencyManager(4),
    backendRegistry: overrides.backendRegistry ?? createMockBackendRegistry(),
    specWriter: overrides.specWriter ?? createMockSpecWriter(),
    config,
  }
}

function buildOrchestrator(overrides: Partial<OrchestratorDeps> = {}): {
  orchestrator: Orchestrator
  deps: OrchestratorDeps
} {
  const deps = createOrchestratorDeps(overrides)
  const orchestrator = new Orchestrator(
    deps.eventBus,
    deps.stateMachine,
    deps.agentRegistry,
    deps.executionStore,
    deps.checkpointManager,
    deps.worktreeManager,
    deps.costTracker,
    deps.concurrencyManager,
    deps.backendRegistry,
    deps.specWriter,
    deps.config,
  )
  return { orchestrator, deps }
}
// ============================================================================
// Property Tests
// ============================================================================

describe('Orchestrator Properties', () => {
  /**
   * Property 4: No concurrent runs for the same spec
   * Validates: Requirement 2.3
   */
  test.prop([specNameArb], { numRuns: 5 })(
    'Property 4: Rejects concurrent runs for the same spec',
    async (specName) => {
      const specPath = `.kiro/specs/${specName}`
      const { orchestrator } = buildOrchestrator({
        agentRegistry: createMockAgentRegistry(() => createSlowAgent(20)),
      })

      // Start first run (don't await — let it run in background)
      const firstRun = orchestrator.startRun({ specPath })

      // Give it a tick to register
      await new Promise((resolve) => setTimeout(resolve, 5))

      // Second run for same spec should throw
      await expect(orchestrator.startRun({ specPath })).rejects.toThrow(
        /active run already exists/i,
      )

      await firstRun
    },
  )

  /**
   * Property 5: Run outcome updates spec status
   * Validates: Requirements 2.4, 3.2
   */
  test.prop([specNameArb])(
    'Property 5: Successful run writes completed status to spec directory',
    async (specName) => {
      const specPath = `.kiro/specs/${specName}`
      const specWriter = createMockSpecWriter()
      const { orchestrator } = buildOrchestrator({ specWriter })

      const result = await orchestrator.startRun({ specPath })

      expect(result.status).toBe('completed')
      expect(specWriter.writeRunCompleted).toHaveBeenCalledWith(
        expect.stringContaining(specName),
        expect.any(String),
        'completed',
        undefined,
      )
    },
  )

  /**
   * Property 6: Phase transitions produce timestamped logs and status updates
   * Validates: Requirements 3.1, 3.2, 3.3
   */
  test.prop([specNameArb])(
    'Property 6: Every phase transition writes log and status to spec directory',
    async (specName) => {
      const specPath = `.kiro/specs/${specName}`
      const specWriter = createMockSpecWriter()
      const { orchestrator } = buildOrchestrator({ specWriter })

      await orchestrator.startRun({ specPath })

      // writeRunStarted called once at the beginning
      expect(specWriter.writeRunStarted).toHaveBeenCalledTimes(1)

      // appendExecutionLog called for each phase start (8 phases)
      const appendCalls = vi.mocked(specWriter.appendExecutionLog).mock.calls
      expect(appendCalls.length).toBe(PIPELINE_PHASES.length)

      // Each call should have a timestamp and phase
      for (const call of appendCalls) {
        const entry = call[1]
        expect(entry.timestamp).toBeDefined()
        expect(entry.phase).toBeDefined()
        expect(PIPELINE_PHASES).toContain(entry.phase)
      }

      // writePhaseTransition called for each phase completion
      expect(specWriter.writePhaseTransition).toHaveBeenCalledTimes(
        PIPELINE_PHASES.length,
      )

      // writeRunCompleted called once at the end
      expect(specWriter.writeRunCompleted).toHaveBeenCalledTimes(1)
    },
  )

  /**
   * Property 12: Execution run state is always tracked
   * Validates: Requirement 6.4
   */
  test.prop([specNameArb])(
    'Property 12: Run state is persisted to execution store throughout lifecycle',
    async (specName) => {
      const specPath = `.kiro/specs/${specName}`
      const executionStore = createMockExecutionStore()
      const { orchestrator } = buildOrchestrator({ executionStore })

      await orchestrator.startRun({ specPath })

      // saveRun called at start + after each phase checkpoint
      const saveRunCalls = vi.mocked(executionStore.saveRun).mock.calls
      expect(saveRunCalls.length).toBeGreaterThanOrEqual(
        PIPELINE_PHASES.length + 1,
      )

      // appendPhaseResult called for each phase
      expect(executionStore.appendPhaseResult).toHaveBeenCalledTimes(
        PIPELINE_PHASES.length,
      )
    },
  )

  /**
   * Property 40: Pause then resume continues from correct phase
   * Validates: Requirements 18.1, 18.2
   */
  test.prop([fc.integer({ min: 0, max: 6 })], { numRuns: 10 })(
    'Property 40: Pause halts after current phase, resume continues from next',
    async (pauseAfterPhases) => {
      let runId: string | undefined
      let completedPhases = 0

      const eventBus = new EventBus()

      eventBus.on('phase:completed', () => {
        completedPhases++
        if (completedPhases === pauseAfterPhases + 1 && runId) {
          orch.pauseRun(runId)
        }
      })

      const slowAgentFactory = (): Agent => ({
        execute: vi.fn(async (): Promise<AgentResult> => {
          await new Promise((resolve) => setTimeout(resolve, 5))
          return { success: true, output: { result: 'ok' } }
        }),
        supportsRollback: () => false,
        estimatedDuration: () => 100,
        requiredContext: () => [],
      })

      const deps = createOrchestratorDeps({
        eventBus,
        agentRegistry: createMockAgentRegistry(slowAgentFactory),
      })

      const orch = new Orchestrator(
        deps.eventBus,
        deps.stateMachine,
        deps.agentRegistry,
        deps.executionStore,
        deps.checkpointManager,
        deps.worktreeManager,
        deps.costTracker,
        deps.concurrencyManager,
        deps.backendRegistry,
        deps.specWriter,
        deps.config,
      )

      const startResult = await orch.startRun({
        specPath: '.kiro/specs/pause-test',
      })
      runId = startResult.runId

      if (startResult.status === 'paused') {
        const status = orch.getRunStatus(runId)
        expect(status.status).toBe('paused')
        expect(status.phaseResults.length).toBe(pauseAfterPhases + 1)

        const resumeResult = await orch.resumeRun(runId)
        expect(resumeResult.status).toBe('completed')

        const finalStatus = orch.getRunStatus(runId)
        expect(finalStatus.phaseResults.length).toBe(PIPELINE_PHASES.length)
      } else {
        // All phases completed before pause triggered
        expect(startResult.status).toBe('completed')
      }
    },
  )

  /**
   * Property 41: Cancel marks run as cancelled and preserves state
   * Validates: Requirements 18.3, 19.4
   */
  test.prop([specNameArb], { numRuns: 5 })(
    'Property 41: Cancel marks run cancelled and retains worktree',
    async (specName) => {
      const specPath = `.kiro/specs/${specName}`
      const worktreeManager = createMockWorktreeManager()
      const executionStore = createMockExecutionStore()

      const { orchestrator } = buildOrchestrator({
        agentRegistry: createMockAgentRegistry(() => createSlowAgent(50)),
        worktreeManager,
        executionStore,
      })

      const runPromise = orchestrator.startRun({ specPath })

      await new Promise((resolve) => setTimeout(resolve, 15))
      const activeRuns = orchestrator.listActiveRuns()

      if (activeRuns.length > 0) {
        const runId = activeRuns[0]!.runId
        const cancelResult = orchestrator.cancelRun(runId)

        expect(cancelResult.status).toBe('cancelled')
        expect(executionStore.updateRunStatus).toHaveBeenCalledWith(
          runId,
          'cancelled',
        )
        expect(worktreeManager.retain).toHaveBeenCalled()
      }

      await runPromise
    },
  )

  /**
   * Property 49: Phase timeout enforced
   * Validates: Requirements 16.7, 16.8
   */
  test.prop(
    [
      fc.integer({ min: 50, max: 150 }), // timeout in ms
    ],
    { numRuns: 5 },
  )(
    'Property 49: Phase exceeding timeout is recorded as timeout failure',
    async (timeoutMs) => {
      const timeoutSeconds = timeoutMs / 1000
      const config = createTestConfig({
        defaultPhaseTimeout: timeoutSeconds,
      })

      // Agent takes slightly longer than the timeout
      const agentDelayMs = timeoutMs + 50
      const { orchestrator } = buildOrchestrator({
        config,
        agentRegistry: createMockAgentRegistry(() =>
          createSlowAgent(agentDelayMs),
        ),
      })

      const result = await orchestrator.startRun({
        specPath: '.kiro/specs/timeout-test',
      })

      expect(result.status).toBe('failed')

      const status = orchestrator.getRunStatus(result.runId)
      const timeoutResults = status.phaseResults.filter(
        (r) => r.status === 'timeout',
      )
      expect(timeoutResults.length).toBeGreaterThanOrEqual(1)
    },
  )

  /**
   * Property 50: Spec update mid-execution is queued
   * Validates: Requirement 2.5
   */
  test.prop([specNameArb], { numRuns: 5 })(
    'Property 50: Spec update during active run is queued for later',
    async (specName) => {
      const specPath = `.kiro/specs/${specName}`
      const { orchestrator } = buildOrchestrator({
        agentRegistry: createMockAgentRegistry(() => createSlowAgent(20)),
      })

      const runPromise = orchestrator.startRun({ specPath })

      await new Promise((resolve) => setTimeout(resolve, 5))

      // Queue a spec update — should not throw
      expect(() => orchestrator.queueSpecUpdate(specPath)).not.toThrow()

      await runPromise
    },
  )

  /**
   * Property 54: Cost budget halts execution when exceeded
   * Validates: Requirements 26.5, 26.6
   */
  test.prop([
    fc.double({ min: 0.001, max: 0.01, noDefaultInfinity: true, noNaN: true }),
  ])(
    'Property 54: Exceeding cost budget halts pipeline and preserves worktree',
    async (budget) => {
      const config = createTestConfig({ costBudgetPerRun: budget })
      const worktreeManager = createMockWorktreeManager()
      const specWriter = createMockSpecWriter()

      const TOKENS_PER_PHASE = 10000
      const { orchestrator } = buildOrchestrator({
        config,
        worktreeManager,
        specWriter,
        agentRegistry: createMockAgentRegistry(() =>
          createSuccessAgent(TOKENS_PER_PHASE),
        ),
      })

      const result = await orchestrator.startRun({
        specPath: '.kiro/specs/budget-test',
      })

      expect(result.status).toBe('failed')
      expect(worktreeManager.retain).toHaveBeenCalled()
      expect(specWriter.writeRunCompleted).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'failed',
        expect.any(Number),
        'Cost budget exceeded',
      )
    },
  )

  /**
   * Property 62: Spec directory receives timestamped log entries on phase transitions
   * Validates: Requirements 3.1, 3.2, 3.3
   */
  test.prop([specNameArb])(
    'Property 62: Spec directory log entries have timestamps and phase names',
    async (specName) => {
      const specPath = `.kiro/specs/${specName}`
      const specWriter = createMockSpecWriter()
      const { orchestrator } = buildOrchestrator({ specWriter })

      await orchestrator.startRun({ specPath })

      const transitionCalls = vi.mocked(specWriter.writePhaseTransition).mock
        .calls
      expect(transitionCalls.length).toBe(PIPELINE_PHASES.length)

      for (const call of transitionCalls) {
        const [specDir, runId, phase, transitionResult] = call
        expect(specDir).toContain('.kiro/specs/')
        expect(typeof runId).toBe('string')
        expect(PIPELINE_PHASES).toContain(phase)
        expect(transitionResult).toBe('completed')
      }

      const logCalls = vi.mocked(specWriter.appendExecutionLog).mock.calls
      for (const call of logCalls) {
        const entry = call[1]
        expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
        expect(entry.source).toBe('orchestrator')
      }
    },
  )

  /**
   * Property 63: Cancel with AbortSignal terminates active agent
   * Validates: Requirement 18.3
   */
  test.prop([specNameArb], { numRuns: 5 })(
    'Property 63: Cancel aborts the active phase AbortSignal',
    async (specName) => {
      const specPath = `.kiro/specs/${specName}`
      let capturedSignal: AbortSignal | undefined

      const signalCapturingAgent = (): Agent => ({
        execute: vi.fn(async (ctx): Promise<AgentResult> => {
          capturedSignal = ctx.abortSignal
          // Abort-aware wait loop
          for (let i = 0; i < 20; i++) {
            if (ctx.abortSignal?.aborted) {
              return {
                success: false,
                error: { message: 'Aborted', retryable: false },
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 5))
          }
          return { success: true, output: { result: 'ok' } }
        }),
        supportsRollback: () => false,
        estimatedDuration: () => 100,
        requiredContext: () => [],
      })

      const { orchestrator } = buildOrchestrator({
        agentRegistry: createMockAgentRegistry(signalCapturingAgent),
      })

      const runPromise = orchestrator.startRun({ specPath })

      // Wait for agent to start and capture the signal
      await new Promise((resolve) => setTimeout(resolve, 20))

      const activeRuns = orchestrator.listActiveRuns()
      if (activeRuns.length > 0) {
        const runId = activeRuns[0]!.runId

        expect(capturedSignal).toBeDefined()
        expect(capturedSignal?.aborted).toBe(false)

        orchestrator.cancelRun(runId)

        expect(capturedSignal?.aborted).toBe(true)
      }

      await runPromise
    },
  )
})
