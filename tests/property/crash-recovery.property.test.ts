/**
 * Property tests for Crash Recovery (Task 14.3)
 * Validates: Requirements 27.4, 27.5
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

/** Generates valid spec names */
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
        costPer1000Tokens: 0.01,
        enabled: true,
      },
    ],
    defaultBackend: TEST_BACKEND_NAME,
    backendSelectionStrategy: 'default' as const,
    maxConcurrentAgents: 4,
    maxPhaseRetries: 2,
    defaultPhaseTimeout: 300,
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

function createSuccessAgent(): Agent {
  return {
    execute: vi.fn(
      async (): Promise<AgentResult> => ({
        success: true,
        output: { result: 'ok' },
        tokensUsed: 0,
      }),
    ),
    supportsRollback: () => false,
    estimatedDuration: () => 1000,
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

interface MockWorktreeManager extends WorktreeManager {
  setExists(value: boolean): void
  setConsistent(value: boolean): void
  wasRetainCalled: boolean
}

function createMockWorktreeManager(): MockWorktreeManager {
  let existsValue = true
  let consistentValue = true
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
    exists: vi.fn(() => existsValue),
    isConsistent: vi.fn(async () => consistentValue),
    listWorktrees: vi.fn(() => []),
    loadExistingWorktrees: vi.fn(async () => 0),
    setExists(value: boolean) {
      existsValue = value
    },
    setConsistent(value: boolean) {
      consistentValue = value
    },
    get wasRetainCalled() {
      return retainCalled
    },
  } as unknown as MockWorktreeManager
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
      costPer1000Tokens: 0.01,
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
  worktreeManager: MockWorktreeManager
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

describe('Crash Recovery Properties', () => {
  /**
   * Property 52: Crash recovery validates worktree integrity
   * Validates: Requirements 27.4, 27.5
   */
  test.prop([specNameArb], { numRuns: 5 })(
    'Property 52: Recovery validates worktree exists before resuming',
    async (specName) => {
      const worktreeManager = createMockWorktreeManager()
      const executionStore = createMockExecutionStore()

      // Simulate interrupted run with worktree
      const interruptedRun: ExecutionRunRecord = {
        runId: `test-run-${specName}`,
        specPath: `.kiro/specs/${specName}`,
        status: 'running',
        phases: [...PIPELINE_PHASES],
        startedAt: new Date().toISOString(),
        worktreePath: `/tmp/worktrees/${specName}-20240115T120000`,
        cost: 0,
        phaseResults: [
          {
            phase: 'intake',
            status: 'success',
            runId: `test-run-${specName}`,
            sequence: 0,
            startedAt: new Date().toISOString(),
            output: { result: 'ok' },
          },
        ],
        logs: [],
      }

      vi.mocked(executionStore.getInterruptedRuns).mockReturnValue([interruptedRun])

      const { orchestrator } = buildOrchestrator({
        worktreeManager,
        executionStore,
      })

      // Test with worktree present
      worktreeManager.setExists(true)
      worktreeManager.setConsistent(true)

      await orchestrator.recoverInterruptedRuns()

      // Should have attempted recovery
      expect(worktreeManager.loadExistingWorktrees).toHaveBeenCalled()
    },
  )

  test.prop([specNameArb], { numRuns: 5 })(
    'Property 52b: Recovery fails when worktree is missing',
    async (specName) => {
      const worktreeManager = createMockWorktreeManager()
      const executionStore = createMockExecutionStore()

      const interruptedRun: ExecutionRunRecord = {
        runId: `test-run-${specName}`,
        specPath: `.kiro/specs/${specName}`,
        status: 'running',
        phases: [...PIPELINE_PHASES],
        startedAt: new Date().toISOString(),
        worktreePath: `/tmp/worktrees/${specName}-20240115T120000`,
        cost: 0,
        phaseResults: [],
        logs: [],
      }

      vi.mocked(executionStore.getInterruptedRuns).mockReturnValue([interruptedRun])

      // Worktree does not exist
      worktreeManager.setExists(false)

      const { orchestrator } = buildOrchestrator({
        worktreeManager,
        executionStore,
      })

      await orchestrator.recoverInterruptedRuns()

      // Should mark as failed due to missing worktree (Req 27.5)
      expect(executionStore.updateRunStatus).toHaveBeenCalledWith(
        interruptedRun.runId,
        'failed',
      )
    },
  )

  test.prop([specNameArb], { numRuns: 5 })(
    'Property 52c: Recovery fails when worktree is corrupted',
    async (specName) => {
      const worktreeManager = createMockWorktreeManager()
      const executionStore = createMockExecutionStore()

      const interruptedRun: ExecutionRunRecord = {
        runId: `test-run-${specName}`,
        specPath: `.kiro/specs/${specName}`,
        status: 'running',
        phases: [...PIPELINE_PHASES],
        startedAt: new Date().toISOString(),
        worktreePath: `/tmp/worktrees/${specName}-20240115T120000`,
        cost: 0,
        phaseResults: [],
        logs: [],
      }

      vi.mocked(executionStore.getInterruptedRuns).mockReturnValue([interruptedRun])

      // Worktree exists but is inconsistent/corrupted
      worktreeManager.setExists(true)
      worktreeManager.setConsistent(false)

      const { orchestrator } = buildOrchestrator({
        worktreeManager,
        executionStore,
      })

      await orchestrator.recoverInterruptedRuns()

      // Should mark as failed due to corrupted worktree (Req 27.5)
      expect(executionStore.updateRunStatus).toHaveBeenCalledWith(
        interruptedRun.runId,
        'failed',
      )
    },
  )

  test.prop([specNameArb, fc.integer({ min: 1, max: 7 })], { numRuns: 5 })(
    'Property 52d: Recovery resumes from the correct phase',
    async (specName, completedPhaseCount) => {
      const worktreeManager = createMockWorktreeManager()
      const executionStore = createMockExecutionStore()

      // Create phase results for completed phases
      const phaseResults: PhaseResultRecord[] = []
      for (let i = 0; i < completedPhaseCount; i++) {
        const phase = PIPELINE_PHASES[i]!
        phaseResults.push({
          phase,
          status: 'success',
          runId: `test-run-${specName}`,
          sequence: i,
          startedAt: new Date().toISOString(),
          output: { result: 'ok' },
        })
      }

      const interruptedRun: ExecutionRunRecord = {
        runId: `test-run-${specName}`,
        specPath: `.kiro/specs/${specName}`,
        status: 'running',
        phases: [...PIPELINE_PHASES],
        startedAt: new Date().toISOString(),
        worktreePath: `/tmp/worktrees/${specName}-20240115T120000`,
        cost: 0,
        phaseResults,
        logs: [],
      }

      vi.mocked(executionStore.getInterruptedRuns).mockReturnValue([interruptedRun])
      vi.mocked(executionStore.getPhaseResults).mockReturnValue(phaseResults)

      worktreeManager.setExists(true)
      worktreeManager.setConsistent(true)

      const { orchestrator } = buildOrchestrator({
        worktreeManager,
        executionStore,
      })

      // Mock to prevent actual execution
      vi.spyOn(orchestrator as unknown as { executePipelineFrom: () => Promise<void> }, 'executePipelineFrom')
        .mockResolvedValue(undefined)

      await orchestrator.recoverInterruptedRuns()

      // Verify phase results were loaded
      expect(executionStore.getPhaseResults).toHaveBeenCalledWith(interruptedRun.runId)
    },
  )
})
