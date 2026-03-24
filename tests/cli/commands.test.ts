/**
 * Unit tests for CLI Commands
 *
 * Requirements: 28.1, 28.2, 28.3, 28.4, 28.5, 28.6, 28.7, 28.8, 28.9
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  formatDuration,
  formatCost,
  formatTimestamp,
  getStatusIcon,
  type CommandContext,
} from '@/cli/commands'
import type { Orchestrator } from '@/core/orchestrator'
import type { ExecutionStore } from '@/infrastructure/execution-store'
import type { CostTracker } from '@/infrastructure/cost-tracker'
import type { KASOConfig } from '@/config/schema'
import type { ExecutionRunRecord, RunStatus, LogEntry } from '@/core/types'

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockConfig(): KASOConfig {
  return {
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
      currentPhase: 'intake',
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
      backendCosts: { 'test-backend': 0.05 },
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
// Formatting Utilities Tests
// =============================================================================

describe('Formatting Utilities', () => {
  describe('formatDuration', () => {
    it('should format milliseconds', () => {
      expect(formatDuration(500)).toBe('500ms')
    })

    it('should format seconds', () => {
      expect(formatDuration(5000)).toBe('5.0s')
      expect(formatDuration(5500)).toBe('5.5s')
    })

    it('should format minutes and seconds', () => {
      expect(formatDuration(65000)).toBe('1m 5s')
      expect(formatDuration(125000)).toBe('2m 5s')
    })

    it('should format hours and minutes', () => {
      expect(formatDuration(3665000)).toBe('1h 1m')
      expect(formatDuration(7205000)).toBe('2h 0m')
    })
  })

  describe('formatCost', () => {
    it('should format cost with 4 decimal places', () => {
      expect(formatCost(0.05)).toBe('$0.0500')
      expect(formatCost(1.5)).toBe('$1.5000')
      expect(formatCost(0)).toBe('$0.0000')
    })

    it('should handle large costs', () => {
      expect(formatCost(100.1234)).toBe('$100.1234')
    })
  })

  describe('formatTimestamp', () => {
    it('should format ISO timestamp to locale string', () => {
      const timestamp = '2024-01-15T10:30:00.000Z'
      const result = formatTimestamp(timestamp)
      expect(result).toContain('2024')
      // Just check it produces a valid date string
      expect(result.length).toBeGreaterThan(0)
    })
  })

  describe('getStatusIcon', () => {
    it('should return correct icons for each status', () => {
      expect(getStatusIcon('pending')).toBe('⏳')
      expect(getStatusIcon('running')).toBe('🔄')
      expect(getStatusIcon('paused')).toBe('⏸️')
      expect(getStatusIcon('completed')).toBe('✅')
      expect(getStatusIcon('failed')).toBe('❌')
      expect(getStatusIcon('cancelled')).toBe('🚫')
    })

    it('should return question mark for unknown status', () => {
      expect(getStatusIcon('unknown' as RunStatus)).toBe('❓')
    })
  })
})

// =============================================================================
// Command Context Tests
// =============================================================================

describe('Command Context', () => {
  it('should create mock context with all required components', () => {
    const context = createMockContext()

    expect(context.orchestrator).toBeDefined()
    expect(context.executionStore).toBeDefined()
    expect(context.costTracker).toBeDefined()
    expect(context.config).toBeDefined()
  })
})

// =============================================================================
// Command Output Tests (via mocking console)
// =============================================================================

describe('Command Output', () => {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let consoleLogSpy: any
  let consoleErrorSpy: any
  let processExitSpy: any
  /* eslint-enable @typescript-eslint/no-explicit-any */

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    // Mark as used
    void consoleErrorSpy
    void processExitSpy
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('status output', () => {
    it('should display run status when run exists', async () => {
      const context = createMockContext()
      const { statusCommand } = await import('@/cli/commands')

      statusCommand(context, 'test-run-123')

      expect(consoleLogSpy).toHaveBeenCalled()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const calls = consoleLogSpy.mock.calls.map((c: any[]) => c[0] as string)
      expect(calls.some((c: string) => c.includes('test-run-123'))).toBe(true)
    })

    it('should list active runs when no run ID provided', async () => {
      const context = createMockContext()
      const { statusCommand } = await import('@/cli/commands')

      statusCommand(context)

      expect(consoleLogSpy).toHaveBeenCalled()
    })
  })

  describe('history output', () => {
    it('should display no history message when empty', async () => {
      const context = createMockContext()
      const { historyCommand } = await import('@/cli/commands')

      historyCommand(context, { limit: 10 })

      expect(consoleLogSpy).toHaveBeenCalled()
    })

    it('should display runs when history exists', async () => {
      const context = createMockContext()
      const runs = [
        createMockRunRecord({ runId: 'run-1', status: 'completed' }),
        createMockRunRecord({ runId: 'run-2', status: 'failed' }),
      ]
      vi.spyOn(context.executionStore, 'getRuns').mockReturnValue(runs)

      const { historyCommand } = await import('@/cli/commands')
      historyCommand(context, { limit: 10 })

      expect(consoleLogSpy).toHaveBeenCalled()
    })
  })

  describe('cost output', () => {
    it('should display cost for specific run', async () => {
      const context = createMockContext()
      const { costCommand } = await import('@/cli/commands')

      costCommand(context, 'test-run-123')

      expect(consoleLogSpy).toHaveBeenCalled()
    })

    it('should display aggregated costs when no run ID', async () => {
      const context = createMockContext()
      const { costCommand } = await import('@/cli/commands')

      costCommand(context)

      expect(consoleLogSpy).toHaveBeenCalled()
    })

    it('should display cost history with --history flag', async () => {
      const context = createMockContext()
      const { costCommand } = await import('@/cli/commands')

      costCommand(context, undefined, { history: true })

      expect(consoleLogSpy).toHaveBeenCalled()
    })
  })

  describe('logs output', () => {
    it('should display logs for a run', async () => {
      const context = createMockContext()
      const logs: LogEntry[] = [
        {
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Test log',
          source: 'intake',
        },
      ]
      const run = createMockRunRecord({ logs })
      vi.spyOn(context.executionStore, 'getRun').mockReturnValue(run)

      const { logsCommand } = await import('@/cli/commands')
      logsCommand(context, 'test-run-123', {})

      expect(consoleLogSpy).toHaveBeenCalled()
    })

    it('should filter logs by phase', async () => {
      const context = createMockContext()
      const logs: LogEntry[] = [
        {
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Log 1',
          source: 'intake',
        },
        {
          timestamp: new Date().toISOString(),
          level: 'info',
          message: 'Log 2',
          source: 'validation',
        },
      ]
      const run = createMockRunRecord({ logs })
      vi.spyOn(context.executionStore, 'getRun').mockReturnValue(run)

      const { logsCommand } = await import('@/cli/commands')
      logsCommand(context, 'test-run-123', { phase: 'intake' })

      expect(consoleLogSpy).toHaveBeenCalled()
    })

    it('should error when run not found', async () => {
      const context = createMockContext()
      vi.spyOn(context.executionStore, 'getRun').mockReturnValue(null)

      const { logsCommand } = await import('@/cli/commands')

      expect(() => logsCommand(context, 'nonexistent', {})).toThrow(
        'process.exit called',
      )
    })
  })

  describe('doctor output', () => {
    it('should display health check results', async () => {
      // Restore only process.exit mock and replace with one that doesn't throw
      processExitSpy.mockRestore()
      vi.spyOn(process, 'exit').mockImplementation(() => {
        return undefined as never
      })

      const { doctorCommand } = await import('@/cli/commands')

      // Call without context to avoid database/config checks that might fail
      doctorCommand()

      expect(consoleLogSpy).toHaveBeenCalled()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const calls = consoleLogSpy.mock.calls.map((c: any[]) => c[0] as string)
      expect(calls.some((c: string) => c.includes('System Health Check'))).toBe(
        true,
      )
    })
  })
})

// =============================================================================
// Orchestrator Command Tests
// =============================================================================

describe('Orchestrator Commands', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  /* eslint-disable @typescript-eslint/no-explicit-any */
  let consoleLogSpy: any
  let consoleErrorSpy: any
  let processExitSpy: any
  /* eslint-enable @typescript-eslint/no-explicit-any */

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })
    // Mark as used
    void consoleErrorSpy
    void processExitSpy
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('start command', () => {
    it('should start a new run successfully', async () => {
      const context = createMockContext()
      const { startCommand } = await import('@/cli/commands')

      await startCommand(context, 'test/spec', {})

      expect(context.orchestrator.startRun).toHaveBeenCalledWith({
        specPath: 'test/spec',
        branchName: undefined,
      })
      expect(consoleLogSpy).toHaveBeenCalled()
    })

    it('should pass branch option when provided', async () => {
      const context = createMockContext()
      const { startCommand } = await import('@/cli/commands')

      await startCommand(context, 'test/spec', { branch: 'develop' })

      expect(context.orchestrator.startRun).toHaveBeenCalledWith({
        specPath: 'test/spec',
        branchName: 'develop',
      })
    })

    it('should exit on error', async () => {
      const context = createMockContext()
      vi.spyOn(context.orchestrator, 'startRun').mockRejectedValue(
        new Error('Start failed'),
      )

      const { startCommand } = await import('@/cli/commands')

      await expect(startCommand(context, 'test/spec', {})).rejects.toThrow(
        'process.exit called',
      )
    })
  })

  describe('pause command', () => {
    it('should pause a run successfully', async () => {
      const context = createMockContext()
      const { pauseCommand } = await import('@/cli/commands')

      pauseCommand(context, 'test-run-123')

      expect(context.orchestrator.pauseRun).toHaveBeenCalledWith('test-run-123')
      expect(consoleLogSpy).toHaveBeenCalled()
    })

    it('should exit on error', async () => {
      const context = createMockContext()
      vi.spyOn(context.orchestrator, 'pauseRun').mockImplementation(() => {
        throw new Error('Pause failed')
      })

      const { pauseCommand } = await import('@/cli/commands')

      expect(() => pauseCommand(context, 'test-run-123')).toThrow(
        'process.exit called',
      )
    })
  })

  describe('resume command', () => {
    it('should resume a run successfully', async () => {
      const context = createMockContext()
      const { resumeCommand } = await import('@/cli/commands')

      await resumeCommand(context, 'test-run-123')

      expect(context.orchestrator.resumeRun).toHaveBeenCalledWith(
        'test-run-123',
      )
      expect(consoleLogSpy).toHaveBeenCalled()
    })

    it('should exit on error', async () => {
      const context = createMockContext()
      vi.spyOn(context.orchestrator, 'resumeRun').mockRejectedValue(
        new Error('Resume failed'),
      )

      const { resumeCommand } = await import('@/cli/commands')

      await expect(resumeCommand(context, 'test-run-123')).rejects.toThrow(
        'process.exit called',
      )
    })
  })

  describe('cancel command', () => {
    it('should cancel a run successfully', async () => {
      const context = createMockContext()
      const { cancelCommand } = await import('@/cli/commands')

      cancelCommand(context, 'test-run-123')

      expect(context.orchestrator.cancelRun).toHaveBeenCalledWith(
        'test-run-123',
      )
      expect(consoleLogSpy).toHaveBeenCalled()
    })

    it('should exit on error', async () => {
      const context = createMockContext()
      vi.spyOn(context.orchestrator, 'cancelRun').mockImplementation(() => {
        throw new Error('Cancel failed')
      })

      const { cancelCommand } = await import('@/cli/commands')

      expect(() => cancelCommand(context, 'test-run-123')).toThrow(
        'process.exit called',
      )
    })
  })
})

// =============================================================================
// Watch Command Tests
// =============================================================================

describe('Watch Command', () => {
  it('should error when file watcher not configured', async () => {
    const context = createMockContext()
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    const processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called')
    })

    const { watchCommand } = await import('@/cli/commands')

    await expect(watchCommand(context)).rejects.toThrow('process.exit called')

    consoleErrorSpy.mockRestore()
    processExitSpy.mockRestore()
  })
})
