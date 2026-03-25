/**
 * Property-based tests for CLI Command Routing
 *
 * Property 53: CLI commands map to orchestrator operations
 *
 * Requirements: 28.1, 28.2, 28.3, 28.4, 28.5, 28.6, 28.7, 28.8, 28.9
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as fc from 'fast-check'
import type { CommandContext } from '@/cli/commands'
import type { Orchestrator } from '@/core/orchestrator'
import type { ExecutionStore } from '@/infrastructure/execution-store'
import type { CostTracker } from '@/infrastructure/cost-tracker'
import type { KASOConfig } from '@/config/schema'
import type { ExecutionRunRecord, RunStatus } from '@/core/types'

// =============================================================================
// Arbitraries
// =============================================================================

const runIdArb = fc
  .string({ minLength: 1, maxLength: 100 })
  .filter((s) => !s.includes('\n') && s.trim().length > 0)
const specPathArb = fc
  .string({ minLength: 1, maxLength: 200 })
  .filter((s) => !s.includes('\n') && s.trim().length > 0)
const branchArb = fc.option(
  fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.includes('\n')),
)
const runStatusArb = fc.constantFrom<RunStatus>(
  'pending',
  'running',
  'paused',
  'completed',
  'failed',
  'cancelled',
)
const limitArb = fc.integer({ min: 1, max: 1000 })

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockConfig(): KASOConfig {
  return {
    phaseBackends: {},
    executorBackends: [
      {
        name: 'test-backend',
        command: 'echo',
        args: [],
        protocol: 'cli-json',
        maxContextWindow: 128000,
        costPer1000Tokens: 0.01,
        enabled: true,
      },
    ],
    defaultBackend: 'test-backend',
    backendSelectionStrategy: 'default',
    maxConcurrentAgents: 2,
    maxPhaseRetries: 2,
    defaultPhaseTimeout: 300,
    phaseTimeouts: {},
    uiBaseline: {
      baselineDir: '.kiro/ui-baselines',
      captureOnPass: true,
      diffThreshold: 0.1,
      viewport: { width: 1280, height: 720 },
    },
    contextCapping: {
      enabled: true,
      charsPerToken: 4,
      relevanceRanking: ['design.md'],
    },
    reviewCouncil: {
      maxReviewRounds: 2,
      enableParallelReview: false,
      perspectives: ['security', 'performance', 'maintainability'],
    },
    webhooks: [],
    mcpServers: [],
    plugins: [],
    customPhases: [],
    executionStore: { type: 'sqlite', path: ':memory:' },
  }
}

function createMockOrchestrator(): Partial<Orchestrator> {
  return {
    startRun: vi
      .fn()
      .mockResolvedValue({ runId: 'test-run-123', status: 'running' }),
    getRunStatus: vi.fn().mockReturnValue({
      runId: 'test-run-123',
      specPath: 'test/spec',
      status: 'running',
      elapsedMs: 5000,
      cost: 0.05,
      phaseResults: [],
    }),
    listActiveRuns: vi.fn().mockReturnValue([]),
    pauseRun: vi
      .fn()
      .mockReturnValue({ runId: 'test-run-123', status: 'paused' }),
    resumeRun: vi
      .fn()
      .mockResolvedValue({ runId: 'test-run-123', status: 'running' }),
    cancelRun: vi
      .fn()
      .mockReturnValue({ runId: 'test-run-123', status: 'cancelled' }),
  }
}

function createMockExecutionStore(): Partial<ExecutionStore> {
  return {
    getRun: vi.fn().mockReturnValue(null),
    getRuns: vi.fn().mockReturnValue([]),
  }
}

function createMockCostTracker(): Partial<CostTracker> {
  return {
    getRunCost: vi.fn().mockReturnValue({
      runId: 'test-run-123',
      totalCost: 0.05,
      backendCosts: {},
      invocations: [],
    }),
    getHistoricalCosts: vi.fn().mockReturnValue([]),
  }
}

function createMockContext(): CommandContext {
  return {
    orchestrator: createMockOrchestrator() as Orchestrator,
    executionStore: createMockExecutionStore() as ExecutionStore,
    costTracker: createMockCostTracker() as CostTracker,
    config: createMockConfig(),
  }
}

function createMockRunRecord(
  overrides: Partial<ExecutionRunRecord> = {},
): ExecutionRunRecord {
  return {
    runId: 'test-run-123',
    specPath: 'test/spec',
    status: 'completed',
    phases: ['intake', 'validation'],
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    worktreePath: '/tmp/worktree',
    cost: 0.05,
    phaseResults: [],
    logs: [],
    ...overrides,
  }
}

// =============================================================================
// Property 53: CLI commands map to orchestrator operations
// =============================================================================

describe('Property 53: CLI commands map to orchestrator operations', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ===========================================================================
  // Property: start command always routes to orchestrator.startRun
  // ===========================================================================

  describe('start command routing', () => {
    it('should map any valid spec path and optional branch to orchestrator.startRun', async () => {
      await fc.assert(
        fc.asyncProperty(specPathArb, branchArb, async (specPath, branch) => {
          const context = createMockContext()
          const { startCommand } = await import('@/cli/commands')

          await startCommand(context, specPath, { branch: branch ?? undefined })

          expect(context.orchestrator.startRun).toHaveBeenCalledWith({
            specPath,
            branchName: branch ?? undefined,
          })
        }),
        { numRuns: 25 },
      )
    })
  })

  // ===========================================================================
  // Property: status command routes based on runId presence
  // ===========================================================================

  describe('status command routing', () => {
    it('should route to getRunStatus when runId is provided', async () => {
      await fc.assert(
        fc.asyncProperty(runIdArb, async (runId) => {
          const context = createMockContext()
          const { statusCommand } = await import('@/cli/commands')

          statusCommand(context, runId)

          expect(context.orchestrator.getRunStatus).toHaveBeenCalledWith(runId)
        }),
        { numRuns: 25 },
      )
    })

    it('should route to listActiveRuns when no runId provided', async () => {
      const context = createMockContext()
      const { statusCommand } = await import('@/cli/commands')

      statusCommand(context)

      expect(context.orchestrator.listActiveRuns).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Property: pause command always routes to orchestrator.pauseRun
  // ===========================================================================

  describe('pause command routing', () => {
    it('should map any runId to orchestrator.pauseRun', async () => {
      await fc.assert(
        fc.asyncProperty(runIdArb, async (runId) => {
          const context = createMockContext()
          const { pauseCommand } = await import('@/cli/commands')

          pauseCommand(context, runId)

          expect(context.orchestrator.pauseRun).toHaveBeenCalledWith(runId)
        }),
        { numRuns: 25 },
      )
    })
  })

  // ===========================================================================
  // Property: resume command always routes to orchestrator.resumeRun
  // ===========================================================================

  describe('resume command routing', () => {
    it('should map any runId to orchestrator.resumeRun', async () => {
      await fc.assert(
        fc.asyncProperty(runIdArb, async (runId) => {
          const context = createMockContext()
          const { resumeCommand } = await import('@/cli/commands')

          await resumeCommand(context, runId)

          expect(context.orchestrator.resumeRun).toHaveBeenCalledWith(runId)
        }),
        { numRuns: 25 },
      )
    })
  })

  // ===========================================================================
  // Property: cancel command always routes to orchestrator.cancelRun
  // ===========================================================================

  describe('cancel command routing', () => {
    it('should map any runId to orchestrator.cancelRun', async () => {
      await fc.assert(
        fc.asyncProperty(runIdArb, async (runId) => {
          const context = createMockContext()
          const { cancelCommand } = await import('@/cli/commands')

          cancelCommand(context, runId)

          expect(context.orchestrator.cancelRun).toHaveBeenCalledWith(runId)
        }),
        { numRuns: 25 },
      )
    })
  })

  // ===========================================================================
  // Property: cost command routes based on runId and options
  // ===========================================================================

  describe('cost command routing', () => {
    it('should route to getRunCost when runId is provided', async () => {
      await fc.assert(
        fc.asyncProperty(runIdArb, async (runId) => {
          const context = createMockContext()
          const { costCommand } = await import('@/cli/commands')

          costCommand(context, runId)

          expect(context.costTracker.getRunCost).toHaveBeenCalledWith(runId)
        }),
        { numRuns: 25 },
      )
    })

    it('should route to getHistoricalCosts when no runId and --history', async () => {
      const context = createMockContext()
      const { costCommand } = await import('@/cli/commands')

      costCommand(context, undefined, { history: true })

      expect(context.costTracker.getHistoricalCosts).toHaveBeenCalled()
    })

    it('should route to getHistoricalCosts for aggregated view when no runId', async () => {
      const context = createMockContext()
      const { costCommand } = await import('@/cli/commands')

      costCommand(context, undefined)

      expect(context.costTracker.getHistoricalCosts).toHaveBeenCalled()
    })
  })

  // ===========================================================================
  // Property: history command routes to executionStore.getRuns with limit
  // ===========================================================================

  describe('history command routing', () => {
    it('should pass any positive limit to executionStore.getRuns', async () => {
      await fc.assert(
        fc.asyncProperty(limitArb, async (limit) => {
          const context = createMockContext()
          const { historyCommand } = await import('@/cli/commands')

          historyCommand(context, { limit })

          expect(context.executionStore.getRuns).toHaveBeenCalledWith(limit)
        }),
        { numRuns: 25 },
      )
    })

    it('should default to 20 when no limit specified', async () => {
      const context = createMockContext()
      const { historyCommand } = await import('@/cli/commands')

      historyCommand(context)

      expect(context.executionStore.getRuns).toHaveBeenCalledWith(20)
    })
  })

  // ===========================================================================
  // Property: logs command routes to executionStore.getRun
  // ===========================================================================

  describe('logs command routing', () => {
    it('should route any runId to executionStore.getRun', async () => {
      await fc.assert(
        fc.asyncProperty(runIdArb, async (runId) => {
          const context = createMockContext()
          vi.spyOn(context.executionStore, 'getRun').mockReturnValue(
            createMockRunRecord({ runId, logs: [] }),
          )
          const { logsCommand } = await import('@/cli/commands')

          logsCommand(context, runId, {})

          expect(context.executionStore.getRun).toHaveBeenCalledWith(runId)
        }),
        { numRuns: 25 },
      )
    })
  })

  // ===========================================================================
  // Property: all run statuses are handled without errors
  // ===========================================================================

  describe('run status handling', () => {
    it('should handle every possible RunStatus without throwing', async () => {
      await fc.assert(
        fc.asyncProperty(runStatusArb, async (status) => {
          const context = createMockContext()
          vi.spyOn(context.orchestrator, 'getRunStatus').mockReturnValue({
            runId: 'test-run',
            specPath: 'test/spec',
            status,
            elapsedMs: 5000,
            cost: 0.05,
            phaseResults: [],
          })

          const { statusCommand } = await import('@/cli/commands')

          // Should not throw for any valid status
          expect(() => statusCommand(context, 'test-run')).not.toThrow()
        }),
        { numRuns: 10 },
      )
    })
  })

  // ===========================================================================
  // Property: error messages from orchestrator are preserved
  // ===========================================================================

  describe('error message preservation', () => {
    it('should propagate error messages from orchestrator failures', async () => {
      const errorArb = fc
        .string({ minLength: 1, maxLength: 200 })
        .filter((s) => s.trim().length > 0)

      await fc.assert(
        fc.asyncProperty(errorArb, async (errorMsg) => {
          const context = createMockContext()
          vi.spyOn(context.orchestrator, 'startRun').mockRejectedValue(
            new Error(errorMsg),
          )
          vi.spyOn(process, 'exit').mockImplementation(() => {
            throw new Error('process.exit called')
          })

          const { startCommand } = await import('@/cli/commands')

          try {
            await startCommand(context, 'test/spec', {})
          } catch {
            // Expected — process.exit mock throws
          }

          const errorCalls = vi.mocked(console.error).mock.calls
          const errorOutput = errorCalls.map((c) => String(c[0])).join(' ')
          expect(errorOutput).toContain(errorMsg)
        }),
        { numRuns: 15 },
      )
    })
  })
})

// =============================================================================
// Formatting Property Tests
// =============================================================================

describe('CLI Formatting Properties', () => {
  let formatDuration: (ms: number) => string
  let formatCost: (cost: number) => string
  let getStatusIcon: (status: RunStatus) => string

  beforeEach(async () => {
    const commands = await import('@/cli/commands')
    formatDuration = commands.formatDuration
    formatCost = commands.formatCost
    getStatusIcon = commands.getStatusIcon
  })

  describe('formatDuration properties', () => {
    it('should never return empty string for any non-negative integer', async () => {
      await fc.assert(
        fc.property(fc.integer({ min: 0, max: 100_000_000 }), (ms) => {
          const result = formatDuration(ms)
          return result.length > 0
        }),
        { numRuns: 100 },
      )
    })

    it('should always contain a numeric digit', async () => {
      await fc.assert(
        fc.property(fc.integer({ min: 0, max: 100_000_000 }), (ms) => {
          const result = formatDuration(ms)
          return /\d/.test(result)
        }),
        { numRuns: 100 },
      )
    })

    it('should always contain a time unit suffix', async () => {
      await fc.assert(
        fc.property(fc.integer({ min: 0, max: 100_000_000 }), (ms) => {
          const result = formatDuration(ms)
          return /ms|s|m|h/.test(result)
        }),
        { numRuns: 100 },
      )
    })
  })

  describe('formatCost properties', () => {
    it('should always start with dollar sign', async () => {
      await fc.assert(
        fc.property(fc.float({ min: 0, max: 10000, noNaN: true }), (cost) =>
          formatCost(cost).startsWith('$'),
        ),
        { numRuns: 100 },
      )
    })

    it('should always have exactly 4 decimal places', async () => {
      await fc.assert(
        fc.property(fc.float({ min: 0, max: 10000, noNaN: true }), (cost) => {
          const result = formatCost(cost)
          const decimalPart = result.split('.')[1]
          return decimalPart !== undefined && decimalPart.length === 4
        }),
        { numRuns: 100 },
      )
    })
  })

  describe('getStatusIcon properties', () => {
    it('should return a non-empty string for every valid RunStatus', async () => {
      await fc.assert(
        fc.property(runStatusArb, (status) => {
          const icon = getStatusIcon(status)
          return icon.length > 0
        }),
        { numRuns: 20 },
      )
    })

    it('should return fallback icon for unknown statuses', () => {
      const icon = getStatusIcon('unknown' as RunStatus)
      expect(icon).toBe('❓')
    })
  })
})
