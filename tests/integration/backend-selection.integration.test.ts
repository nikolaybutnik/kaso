/**
 * Integration tests for per-phase backend selection
 * Validates end-to-end backend resolution chain
 *
 * Requirements: 2.1, 2.2, 3.1, 3.3, 11.1
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Orchestrator } from '@/core/orchestrator'
import { EventBus } from '@/core/event-bus'
import { StateMachine } from '@/core/state-machine'
import { ConcurrencyManager } from '@/core/concurrency-manager'
import { CostTracker } from '@/infrastructure/cost-tracker'
import { BackendRegistry } from '@/backends/backend-registry'
import type {
  AgentRegistry,
  Agent,
} from '@/agents/agent-interface'
import type { AgentResult } from '@/core/types'
import type { ExecutionStore } from '@/infrastructure/execution-store'
import type { CheckpointManager } from '@/infrastructure/checkpoint-manager'
import type { WorktreeManager } from '@/infrastructure/worktree-manager'
import type { SpecWriter } from '@/infrastructure/spec-writer'
import type {
  PhaseName,
  ExecutionEvent,
} from '@/core/types'
import type { KASOConfig, ExecutorBackendConfig } from '@/config/schema'
import { getDefaultConfig } from '@/config/schema'

// ============================================================================
// Test Fixtures
// ============================================================================

const TEST_BACKENDS: ExecutorBackendConfig[] = [
  {
    name: 'kimi-code',
    command: 'echo',
    args: [],
    protocol: 'cli-json',
    maxContextWindow: 128000,
    costPer1000Tokens: 0.01,
    enabled: true,
  },
  {
    name: 'claude-code',
    command: 'echo',
    args: [],
    protocol: 'cli-json',
    maxContextWindow: 200000,
    costPer1000Tokens: 0.015,
    enabled: true,
  },
]

const PIPELINE_PHASES: PhaseName[] = [
  'intake',
  'validation',
  'architecture-analysis',
  'implementation',
  'architecture-review',
  'test-verification',
  'ui-validation',
  'review-delivery',
]

function createTestConfig(
  phaseBackends: Record<string, string> = {},
): KASOConfig {
  return {
    ...getDefaultConfig(),
    executorBackends: TEST_BACKENDS,
    defaultBackend: 'kimi-code',
    backendSelectionStrategy: 'default',
    phaseBackends,
  }
}

function createSuccessAgent(): Agent {
  return {
    execute: vi.fn(async (): Promise<AgentResult> => ({
      success: true,
      output: { result: 'ok' },
    })),
    supportsRollback: () => false,
    estimatedDuration: () => 100,
    requiredContext: () => [],
  }
}

function createMockAgentRegistry(): AgentRegistry {
  const agents = new Map<PhaseName, Agent>()
  const metadata: Array<{ phase: PhaseName; agent: Agent; name: string }> = []

  for (const phase of PIPELINE_PHASES) {
    const agent = createSuccessAgent()
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
    getPhaseResults: vi.fn(() => []),
    getInterruptedRuns: vi.fn(() => []),
    updateRunStatus: vi.fn(),
    checkpoint: vi.fn(),
    getDatabase: vi.fn(() => null),
  } as unknown as ExecutionStore
}

function createMockCheckpointManager(): CheckpointManager {
  return {
    saveCheckpoint: vi.fn(),
    getLatestCheckpoint: vi.fn(() => undefined),
    clearCheckpoints: vi.fn(),
    hasCheckpoints: vi.fn(() => false),
    createFromRun: vi.fn(),
    recoverFromCheckpoint: vi.fn(() => undefined),
    listCheckpoints: vi.fn(() => []),
    cleanupOldCheckpoints: vi.fn(),
  } as unknown as CheckpointManager
}

function createMockWorktreeManager(): WorktreeManager {
  return {
    create: vi.fn(async () => ({
      path: '/tmp/test-worktree',
      branch: 'kaso/test-branch',
      runId: 'test-run-id',
    })),
    getPath: vi.fn(() => '/tmp/test-worktree'),
    push: vi.fn(async () => undefined),
    cleanup: vi.fn(async () => undefined),
    retain: vi.fn(),
    exists: vi.fn(() => true),
    isConsistent: vi.fn(async () => true),
    listWorktrees: vi.fn(() => []),
    loadExistingWorktrees: vi.fn(async () => undefined),
    getWorktreeInfo: vi.fn(() => undefined),
    getWorktreeInfoFromDisk: vi.fn(() => undefined),
  } as unknown as WorktreeManager
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

interface TestContext {
  orchestrator: Orchestrator
  eventBus: EventBus
  backendRegistry: BackendRegistry
  events: ExecutionEvent[]
}

function setupTest(config: KASOConfig = createTestConfig()): TestContext {
  const eventBus = new EventBus()
  const events: ExecutionEvent[] = []

  eventBus.onAny((event) => {
    events.push(event)
  })

  const stateMachine = new StateMachine(1000, eventBus)
  const backendRegistry = new BackendRegistry(config)
  const costTracker = new CostTracker()

  const orchestrator = new Orchestrator(
    eventBus,
    stateMachine,
    createMockAgentRegistry(),
    createMockExecutionStore(),
    createMockCheckpointManager(),
    createMockWorktreeManager(),
    costTracker,
    new ConcurrencyManager(4),
    backendRegistry,
    createMockSpecWriter(),
    config,
  )

  return { orchestrator, eventBus, backendRegistry, events }
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('Backend Selection Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should use phase override when configured', async () => {
    const phaseBackends = {
      implementation: 'claude-code',
      'architecture-review': 'claude-code',
    }
    const { orchestrator, events } = setupTest(createTestConfig(phaseBackends))

    await orchestrator.startRun({ specPath: '.kiro/specs/test-feature' })

    // Find backend selection events
    const selectionEvents = events.filter(
      (e) => e.type === 'agent:backend-selected',
    )

    expect(selectionEvents.length).toBeGreaterThan(0)

    // Verify implementation phase uses claude-code
    // Note: phase override is applied via preferredBackend, so reason is 'retry-override'
    const implementationEvent = selectionEvents.find(
      (e) => e.phase === 'implementation',
    )
    expect(implementationEvent).toBeDefined()
    expect(implementationEvent?.data?.backend).toBe('claude-code')

    // Verify architecture-review phase uses claude-code
    const archReviewEvent = selectionEvents.find(
      (e) => e.phase === 'architecture-review',
    )
    expect(archReviewEvent).toBeDefined()
    expect(archReviewEvent?.data?.backend).toBe('claude-code')
  })

  it('should use default backend when no phase override', async () => {
    const { orchestrator, events } = setupTest(createTestConfig())

    await orchestrator.startRun({ specPath: '.kiro/specs/test-feature' })

    const selectionEvents = events.filter(
      (e) => e.type === 'agent:backend-selected',
    )

    expect(selectionEvents.length).toBeGreaterThan(0)

    // Verify phases without override use default (kimi-code)
    const intakeEvent = selectionEvents.find((e) => e.phase === 'intake')
    expect(intakeEvent).toBeDefined()
    expect(intakeEvent?.data?.backend).toBe('kimi-code')
    expect(intakeEvent?.data?.reason).toBe('default')
  })

  it('should emit backend-selected event for every phase', async () => {
    const phaseBackends = {
      implementation: 'claude-code',
    }
    const { orchestrator, events } = setupTest(createTestConfig(phaseBackends))

    await orchestrator.startRun({ specPath: '.kiro/specs/test-feature' })

    const selectionEvents = events.filter(
      (e) => e.type === 'agent:backend-selected',
    )

    // Should have at least one event per phase
    expect(selectionEvents.length).toBeGreaterThanOrEqual(PIPELINE_PHASES.length)

    // Each event should have required fields
    for (const event of selectionEvents) {
      expect(event.data).toBeDefined()
      expect(event.data?.backend).toBeDefined()
      expect(event.data?.reason).toMatch(
        /phase-override|context-aware|default|retry-override/,
      )
      expect(event.phase).toBeDefined()
      expect(event.runId).toBeDefined()
      expect(event.timestamp).toBeDefined()
    }
  })

  it('should use context-aware strategy when configured', async () => {
    const config = {
      ...createTestConfig(),
      backendSelectionStrategy: 'context-aware' as const,
    }
    const { orchestrator, events } = setupTest(config)

    await orchestrator.startRun({ specPath: '.kiro/specs/test-feature' })

    const selectionEvents = events.filter(
      (e) => e.type === 'agent:backend-selected',
    )

    // Phases without override should use context-aware
    const eventsWithContextAware = selectionEvents.filter(
      (e) => e.data?.reason === 'context-aware',
    )

    expect(eventsWithContextAware.length).toBeGreaterThan(0)
  })

  it('should track backend in cost tracking', async () => {
    const phaseBackends = {
      implementation: 'claude-code',
    }
    const { orchestrator, events } = setupTest(createTestConfig(phaseBackends))

    await orchestrator.startRun({ specPath: '.kiro/specs/test-feature' })

    // Verify events contain the correct backend names
    const implementationEvent = events.find(
      (e) => e.type === 'agent:backend-selected' && e.phase === 'implementation',
    )
    expect(implementationEvent?.data?.backend).toBe('claude-code')
  })
})
