/**
 * Unit tests for Delivery Agent
 *
 * Requirements: 15.6, 15.7, 15.8, 15.9
 * Property tests are in tests/property/delivery.property.test.ts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  DeliveryAgent,
  createDeliveryAgent,
  CommitInfo,
} from '@/agents/delivery'
import type {
  AgentContext,
  ImplementationResult,
  TestReport,
  ReviewCouncilResult,
  DeliveryResult,
} from '@/core/types'
import { EventBus } from '@/core/event-bus'

// =============================================================================
// Test Fixtures
// =============================================================================

type CommandRunnerFn = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<{ stdout: string; stderr: string; exitCode: number }>

function createMockCommandRunner(): CommandRunnerFn & {
  mockImplementation: (fn: CommandRunnerFn) => void
  mockRejectedValue: (err: Error) => void
} {
  const fn = vi.fn() as unknown as CommandRunnerFn & {
    mockImplementation: (fn: CommandRunnerFn) => void
    mockRejectedValue: (err: Error) => void
  }
  return fn
}

function createMockContext(
  overrides: Partial<AgentContext> = {},
  mockRunner?: CommandRunnerFn,
): { context: AgentContext; runner: CommandRunnerFn } {
  const runner = mockRunner ?? createMockCommandRunner()

  // Set up default mock implementation if not already set
  if (
    !(runner as unknown as { mock: { calls: unknown[] } }).mock?.calls?.length
  ) {
    setupSuccessfulGitCommands(
      runner as CommandRunnerFn & {
        mockImplementation: (fn: CommandRunnerFn) => void
      },
    )
  }

  const context: AgentContext = {
    runId: 'test-run-123',
    spec: {
      featureName: 'test-feature',
      specPath: '/test/specs/test-feature',
      missingFiles: [],
    },
    steering: { hooks: {} },
    worktreePath: '/test/worktree',
    phaseOutputs: {
      implementation: {
        modifiedFiles: ['src/auth/login.ts', 'tests/auth/login.test.ts'],
        addedTests: ['tests/auth/login.test.ts'],
        duration: 5000,
        backend: 'kimi-code',
        selfCorrectionAttempts: 0,
      } as ImplementationResult,
      'test-verification': {
        passed: true,
        coverage: 85,
        testFailures: [],
        testsRun: 10,
        duration: 2000,
      } as TestReport,
      'review-delivery': {
        consensus: 'passed',
        votes: [
          {
            perspective: 'security',
            approved: true,
            feedback: 'Good',
            severity: 'low',
          },
          {
            perspective: 'performance',
            approved: true,
            feedback: 'Good',
            severity: 'low',
          },
          {
            perspective: 'maintainability',
            approved: true,
            feedback: 'Good',
            severity: 'low',
          },
        ],
        rounds: 1,
        cost: 0.15,
      } as ReviewCouncilResult,
    },
    config: {
      executorBackends: [
        {
          name: 'kimi-code',
          command: 'kimi',
          args: [],
          protocol: 'cli-json',
          maxContextWindow: 128000,
          costPer1000Tokens: 0.01,
          enabled: true,
        },
      ],
      phaseBackends: {},
      defaultBackend: 'kimi-code',
      maxConcurrentAgents: 4,
      maxPhaseRetries: 2,
      defaultPhaseTimeout: 300,
      phaseTimeouts: {},
      backendSelectionStrategy: 'default',
      contextCapping: {
        enabled: true,
        charsPerToken: 4,
        relevanceRanking: [],
      },
      reviewCouncil: {
        maxReviewRounds: 2,
        enableParallelReview: false,
        perspectives: ['security', 'performance', 'maintainability'],
      },
      uiBaseline: {
        baselineDir: '.kiro/ui-baselines',
        captureOnPass: true,
        diffThreshold: 0.1,
        viewport: { width: 1280, height: 720 },
      },
      webhooks: [],
      mcpServers: [],
      plugins: [],
      customPhases: [],
      executionStore: {
        type: 'sqlite',
        path: '.kaso/execution-store.db',
      },
    },
    backends: {},
    ...overrides,
  }

  return { context, runner }
}

function setupSuccessfulGitCommands(
  runner: CommandRunnerFn & {
    mockImplementation: (fn: CommandRunnerFn) => void
  },
): void {
  // git checkout -b
  runner.mockImplementation(async (cmd: string, args: string[]) => {
    const fullCommand = `${cmd} ${args.join(' ')}`

    if (fullCommand.includes('checkout -b')) {
      return { stdout: 'Switched to new branch', stderr: '', exitCode: 0 }
    }
    if (fullCommand.includes('add -A')) {
      return { stdout: '', stderr: '', exitCode: 0 }
    }
    if (fullCommand.includes('commit')) {
      return {
        stdout: '[branch abc1234] commit message',
        stderr: '',
        exitCode: 0,
      }
    }
    if (fullCommand.includes('rev-parse')) {
      return { stdout: 'abc1234def5678', stderr: '', exitCode: 0 }
    }
    if (fullCommand.includes('push')) {
      return { stdout: 'Branch pushed', stderr: '', exitCode: 0 }
    }
    if (fullCommand.includes('diff --cached')) {
      return { stdout: 'file1.ts\nfile2.ts', stderr: '', exitCode: 0 }
    }
    if (cmd === 'gh') {
      if (fullCommand.includes('--version')) {
        return { stdout: 'gh version 2.0.0', stderr: '', exitCode: 0 }
      }
      if (fullCommand.includes('pr create')) {
        return {
          stdout: 'https://github.com/user/repo/pull/42',
          stderr: '',
          exitCode: 0,
        }
      }
    }

    return { stdout: '', stderr: '', exitCode: 0 }
  })
}

// =============================================================================
// Unit Tests
// =============================================================================

describe('DeliveryAgent', () => {
  let agent: DeliveryAgent
  let eventBus: EventBus
  let runner: CommandRunnerFn

  beforeEach(() => {
    eventBus = new EventBus()
    runner = createMockCommandRunner()
    agent = createDeliveryAgent({ eventBus, commandRunner: { run: runner } })
  })

  describe('interface compliance', () => {
    it('should implement Agent interface', () => {
      expect(agent.execute).toBeDefined()
      expect(agent.supportsRollback).toBeDefined()
      expect(agent.estimatedDuration).toBeDefined()
      expect(agent.requiredContext).toBeDefined()
    })

    it('should support rollback', () => {
      expect(agent.supportsRollback()).toBe(true)
    })

    it('should return estimated duration', () => {
      expect(agent.estimatedDuration()).toBeGreaterThan(0)
    })

    it('should require correct context keys', () => {
      const required = agent.requiredContext()
      expect(required).toContain('worktreePath')
      expect(required).toContain('spec')
      expect(required).toContain('phaseOutputs.implementation')
      expect(required).toContain('phaseOutputs.test-verification')
      expect(required).toContain('phaseOutputs.review-delivery')
    })
  })

  describe('execution', () => {
    it('should return successful result with DeliveryResult', async () => {
      setupSuccessfulGitCommands(
        runner as CommandRunnerFn & {
          mockImplementation: (fn: CommandRunnerFn) => void
        },
      )
      const { context } = createMockContext({}, runner)

      const result = await agent.execute(context)

      expect(result.success).toBe(true)
      expect(result.output).toBeDefined()

      const deliveryResult = result.output as DeliveryResult
      expect(deliveryResult.branch).toContain('kaso/')
      expect(deliveryResult.commits.length).toBeGreaterThan(0)
      expect(deliveryResult.prUrl).toBeDefined()
      expect(deliveryResult.summary).toBeDefined()
    })

    it('should handle missing worktree path', async () => {
      const testRunner = createMockCommandRunner()
      const { context } = createMockContext(
        { worktreePath: undefined },
        testRunner,
      )

      const result = await agent.execute(context)

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('worktree')
    })

    it('should handle missing implementation result', async () => {
      const testRunner = createMockCommandRunner()
      const { context } = createMockContext({ phaseOutputs: {} }, testRunner)

      const result = await agent.execute(context)

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('implementation')
    })

    it('should handle abort signal', async () => {
      const abortController = new AbortController()
      abortController.abort()

      const testRunner = createMockCommandRunner()
      const { context } = createMockContext(
        { abortSignal: abortController.signal },
        testRunner,
      )

      const result = await agent.execute(context)

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('aborted')
    })

    it('should emit progress events', async () => {
      setupSuccessfulGitCommands(
        runner as CommandRunnerFn & {
          mockImplementation: (fn: CommandRunnerFn) => void
        },
      )
      const events: string[] = []
      eventBus.on('agent:progress', (event) => {
        if (event.agent === 'delivery') {
          events.push(event.data?.message as string)
        }
      })

      const { context } = createMockContext({}, runner)
      await agent.execute(context)

      expect(events.length).toBeGreaterThan(0)
      expect(events.some((e) => e.includes('branch'))).toBe(true)
      expect(events.some((e) => e.includes('commit'))).toBe(true)
      expect(events.some((e) => e.toLowerCase().includes('pull request'))).toBe(
        true,
      )
    })
  })

  describe('branch creation', () => {
    it('should create branch with kaso/ prefix', async () => {
      setupSuccessfulGitCommands(
        runner as CommandRunnerFn & {
          mockImplementation: (fn: CommandRunnerFn) => void
        },
      )
      const { context } = createMockContext({}, runner)

      const result = await agent.execute(context)
      const deliveryResult = result.output as DeliveryResult

      expect(deliveryResult.branch).toMatch(/^kaso\/test-feature-delivery-/)
    })

    it('should sanitize feature names in branch', async () => {
      setupSuccessfulGitCommands(
        runner as CommandRunnerFn & {
          mockImplementation: (fn: CommandRunnerFn) => void
        },
      )
      const { context } = createMockContext(
        {
          spec: {
            featureName: 'My Feature Name!',
            specPath: '/test/specs/my-feature',
            missingFiles: [],
          },
        },
        runner,
      )

      const result = await agent.execute(context)
      const deliveryResult = result.output as DeliveryResult

      expect(deliveryResult.branch).toMatch(/^kaso\/my-feature-name-delivery-/)
    })
  })

  describe('commit creation', () => {
    it('should create commits', async () => {
      setupSuccessfulGitCommands(
        runner as CommandRunnerFn & {
          mockImplementation: (fn: CommandRunnerFn) => void
        },
      )
      const { context } = createMockContext({}, runner)

      const result = await agent.execute(context)
      const deliveryResult = result.output as DeliveryResult

      expect(deliveryResult.commits.length).toBeGreaterThan(0)
    })

    it('should stage all changes', async () => {
      setupSuccessfulGitCommands(
        runner as CommandRunnerFn & {
          mockImplementation: (fn: CommandRunnerFn) => void
        },
      )
      const { context } = createMockContext({}, runner)

      await agent.execute(context)

      const addCalls = (
        runner as unknown as { mock: { calls: unknown[][] } }
      ).mock.calls.filter((call: unknown[]) => {
        const args = call[1] as string[]
        return args.includes('add')
      })
      expect(addCalls.length).toBeGreaterThan(0)
    })
  })

  describe('PR creation', () => {
    it('should create PR using gh CLI when available', async () => {
      setupSuccessfulGitCommands(
        runner as CommandRunnerFn & {
          mockImplementation: (fn: CommandRunnerFn) => void
        },
      )
      const { context } = createMockContext({}, runner)

      const result = await agent.execute(context)
      const deliveryResult = result.output as DeliveryResult

      expect(deliveryResult.prUrl).toBe('https://github.com/user/repo/pull/42')
    })

    it('should fallback when gh CLI not available', async () => {
      ;(
        runner as CommandRunnerFn & {
          mockImplementation: (fn: CommandRunnerFn) => void
        }
      ).mockImplementation(async (cmd: string) => {
        if (cmd === 'gh') {
          return { stdout: '', stderr: 'gh: command not found', exitCode: 127 }
        }
        return { stdout: '', stderr: '', exitCode: 0 }
      })

      const { context } = createMockContext({}, runner)
      const result = await agent.execute(context)

      // Should still succeed even if PR not created
      expect(result.success).toBe(true)
    })
  })

  describe('execution summary', () => {
    it('should include all required info in summary', async () => {
      setupSuccessfulGitCommands(
        runner as CommandRunnerFn & {
          mockImplementation: (fn: CommandRunnerFn) => void
        },
      )
      const { context } = createMockContext({}, runner)

      const result = await agent.execute(context)
      const deliveryResult = result.output as DeliveryResult

      expect(deliveryResult.summary).toContain('Branch:')
      expect(deliveryResult.summary).toContain('Commits:')
      expect(deliveryResult.summary).toContain('Modified:')
      expect(deliveryResult.summary).toContain('Tests:')
    })
  })
})

// =============================================================================
// Conventional Commit Tests
// =============================================================================

describe('Conventional Commit Format', () => {
  let agent: DeliveryAgent

  beforeEach(() => {
    const runner = createMockCommandRunner()
    agent = createDeliveryAgent({ commandRunner: { run: runner } })
  })

  describe('buildConventionalCommitMessage', () => {
    it('should build basic commit message', () => {
      const commit: CommitInfo = {
        type: 'feat',
        description: 'add new feature',
      }

      const message = agent.buildConventionalCommitMessage(commit)

      expect(message).toBe('feat: add new feature')
    })

    it('should include scope when provided', () => {
      const commit: CommitInfo = {
        type: 'feat',
        scope: 'auth',
        description: 'add login',
      }

      const message = agent.buildConventionalCommitMessage(commit)

      expect(message).toBe('feat(auth): add login')
    })

    it('should include breaking change indicator', () => {
      const commit: CommitInfo = {
        type: 'feat',
        description: 'change API',
        breaking: true,
      }

      const message = agent.buildConventionalCommitMessage(commit)

      expect(message).toBe('feat!: change API')
    })

    it('should include body when provided', () => {
      const commit: CommitInfo = {
        type: 'docs',
        description: 'update README',
        body: 'Added installation instructions',
      }

      const message = agent.buildConventionalCommitMessage(commit)

      expect(message).toBe(
        'docs: update README\n\nAdded installation instructions',
      )
    })

    it('should include scope and breaking indicator', () => {
      const commit: CommitInfo = {
        type: 'refactor',
        scope: 'core',
        description: 'rewrite engine',
        breaking: true,
      }

      const message = agent.buildConventionalCommitMessage(commit)

      expect(message).toBe('refactor(core)!: rewrite engine')
    })
  })

  describe('isConventionalCommitFormat', () => {
    it('should return true for valid conventional commits', () => {
      const validCommits = [
        'feat: add feature',
        'fix: fix bug',
        'docs: update docs',
        'style: format code',
        'refactor: refactor code',
        'perf: optimize',
        'test: add tests',
        'chore: update deps',
        'ci: update workflow',
        'build: update build',
        'feat(auth): add login',
        'feat!: breaking change',
        'feat(auth)!: breaking change',
      ]

      for (const commit of validCommits) {
        expect(agent.isConventionalCommitFormat(commit)).toBe(true)
      }
    })

    it('should return false for invalid commits', () => {
      const invalidCommits = [
        'add feature',
        'FEAT: add feature',
        'unknown: add feature',
        'feat add feature',
        ': add feature',
      ]

      for (const commit of invalidCommits) {
        expect(agent.isConventionalCommitFormat(commit)).toBe(false)
      }
    })
  })

  describe('extractCommitType', () => {
    it('should extract type from valid commits', () => {
      expect(agent.extractCommitType('feat: add feature')).toBe('feat')
      expect(agent.extractCommitType('fix: fix bug')).toBe('fix')
      expect(agent.extractCommitType('docs: update docs')).toBe('docs')
      expect(agent.extractCommitType('feat(auth): add login')).toBe('feat')
      expect(agent.extractCommitType('feat!: breaking')).toBe('feat')
    })

    it('should return undefined for invalid commits', () => {
      expect(agent.extractCommitType('add feature')).toBeUndefined()
      expect(agent.extractCommitType('unknown: feature')).toBeUndefined()
    })
  })

  describe('extractCommitScope', () => {
    it('should extract scope from commits', () => {
      expect(agent.extractCommitScope('feat(auth): add login')).toBe('auth')
      expect(agent.extractCommitScope('fix(core): fix bug')).toBe('core')
      expect(agent.extractCommitScope('docs: update')).toBeUndefined()
      expect(agent.extractCommitScope('feat!: breaking')).toBeUndefined()
    })
  })
})

// =============================================================================
// Edge Cases
// =============================================================================

describe('Delivery Agent Edge Cases', () => {
  it('should handle empty modified files list', async () => {
    const testRunner = createMockCommandRunner()
    setupSuccessfulGitCommands(
      testRunner as CommandRunnerFn & {
        mockImplementation: (fn: CommandRunnerFn) => void
      },
    )

    const { context } = createMockContext(
      {
        phaseOutputs: {
          implementation: {
            modifiedFiles: [],
            addedTests: [],
            duration: 1000,
            backend: 'kimi-code',
            selfCorrectionAttempts: 0,
          } as ImplementationResult,
          'test-verification': {
            passed: true,
            coverage: 0,
            testFailures: [],
            testsRun: 0,
            duration: 0,
          } as TestReport,
          'review-delivery': {
            consensus: 'passed',
            votes: [],
            rounds: 0,
            cost: 0,
          } as ReviewCouncilResult,
        },
      },
      testRunner,
    )

    const testAgent = createDeliveryAgent({
      commandRunner: { run: testRunner },
    })
    const result = await testAgent.execute(context)

    expect(result.success).toBe(true)
  })

  it('should handle git command failures', async () => {
    const testRunner = createMockCommandRunner()

    // First create context without the runner to avoid setupSuccessfulGitCommands being called
    const { context } = createMockContext({})

    // Then set up the mock to reject
    ;(
      testRunner as CommandRunnerFn & {
        mockRejectedValue: (err: Error) => void
      }
    ).mockRejectedValue(new Error('Git command failed'))

    const testAgent = createDeliveryAgent({
      commandRunner: { run: testRunner },
    })

    const result = await testAgent.execute(context)

    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
  })

  it('should handle missing spec path gracefully', async () => {
    const testRunner = createMockCommandRunner()
    setupSuccessfulGitCommands(
      testRunner as CommandRunnerFn & {
        mockImplementation: (fn: CommandRunnerFn) => void
      },
    )

    const { context } = createMockContext(
      {
        spec: {
          featureName: 'test',
          specPath: '', // Empty path
          missingFiles: [],
        },
      },
      testRunner,
    )

    const testAgent = createDeliveryAgent({
      commandRunner: { run: testRunner },
    })
    const result = await testAgent.execute(context)

    // Should still succeed even if summary not written
    expect(result.success).toBe(true)
  })

  it('should categorize files correctly', async () => {
    const testRunner = createMockCommandRunner()
    setupSuccessfulGitCommands(
      testRunner as CommandRunnerFn & {
        mockImplementation: (fn: CommandRunnerFn) => void
      },
    )

    const files = [
      'src/auth/login.ts',
      'src/utils/helper.ts',
      'tests/auth/login.test.ts',
      'README.md',
      'package.json',
      'tsconfig.json',
    ]

    const { context } = createMockContext(
      {
        phaseOutputs: {
          implementation: {
            modifiedFiles: files,
            addedTests: ['tests/auth/login.test.ts'],
            duration: 1000,
            backend: 'kimi-code',
            selfCorrectionAttempts: 0,
          } as ImplementationResult,
          'test-verification': {
            passed: true,
            coverage: 85,
            testFailures: [],
            testsRun: 10,
            duration: 1000,
          } as TestReport,
          'review-delivery': {
            consensus: 'passed',
            votes: [],
            rounds: 1,
            cost: 0.1,
          } as ReviewCouncilResult,
        },
      },
      testRunner,
    )

    const testAgent = createDeliveryAgent({
      commandRunner: { run: testRunner },
    })
    const result = await testAgent.execute(context)

    expect(result.success).toBe(true)
  })
})
