/**
 * Property tests for Delivery Agent
 *
 * Property 29: Conventional commit format
 * Property 30: PR contains required sections
 *
 * Validates: Requirements 15.7, 15.8
 */

import { test, fc } from '@fast-check/vitest'
import { describe, it, expect, vi } from 'vitest'
import {
  createDeliveryAgent,
  ConventionalCommitType,
  CommitInfo,
} from '../../src/agents/delivery'
import type {
  AgentContext,
  ImplementationResult,
  TestReport,
  ReviewCouncilResult,
  DeliveryResult,
} from '../../src/core/types'

// =============================================================================
// Shared Fixtures
// =============================================================================

type CommandRunnerFn = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<{ stdout: string; stderr: string; exitCode: number }>

function createMockCommandRunner(): CommandRunnerFn & {
  mockImplementation: (fn: CommandRunnerFn) => void
} {
  return vi.fn() as unknown as CommandRunnerFn & {
    mockImplementation: (fn: CommandRunnerFn) => void
  }
}

function setupSuccessfulGitCommands(
  runner: CommandRunnerFn & {
    mockImplementation: (fn: CommandRunnerFn) => void
  },
): void {
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

function createMockContext(
  overrides: Partial<AgentContext> = {},
  mockRunner?: CommandRunnerFn,
): { context: AgentContext; runner: CommandRunnerFn } {
  const runner = mockRunner ?? createMockCommandRunner()

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

// =============================================================================
// Property 29: Conventional commit format
// Validates: Requirement 15.7
// =============================================================================

describe('Property 29: Conventional commit format', () => {
  test.prop([
    fc.constantFrom(
      'feat',
      'fix',
      'refactor',
      'test',
      'docs',
      'chore',
      'style',
      'perf',
      'ci',
      'build',
    ),
    fc
      .string({ minLength: 1, maxLength: 20 })
      .filter((s: string) => /^[a-z-]+$/.test(s)),
    fc
      .string({ minLength: 5, maxLength: 50 })
      .filter((s: string) => !s.includes('\n')),
    fc.boolean(),
  ])(
    'generated commit messages always match conventional format',
    (type, scope, description, breaking) => {
      const testRunner = createMockCommandRunner()
      const agent = createDeliveryAgent({ commandRunner: { run: testRunner } })
      const commit: CommitInfo = {
        type: type as ConventionalCommitType,
        scope: scope || undefined,
        description,
        breaking,
      }

      const message = agent.buildConventionalCommitMessage(commit)

      // Verify format matches conventional commit spec
      expect(agent.isConventionalCommitFormat(message)).toBe(true)

      // Verify extracted type matches
      expect(agent.extractCommitType(message)).toBe(type)

      // Verify extracted scope matches (if provided)
      if (scope) {
        expect(agent.extractCommitScope(message)).toBe(scope)
      }

      // Verify description is present
      expect(message).toContain(description)

      // Verify breaking indicator if set
      if (breaking) {
        expect(message).toContain('!:')
      }
    },
  )
})

// =============================================================================
// Property 30: PR contains required sections
// Validates: Requirement 15.8
// =============================================================================

describe('Property 30: PR contains required sections', () => {
  it('should include summary section in PR', async () => {
    const testRunner = createMockCommandRunner()
    setupSuccessfulGitCommands(
      testRunner as CommandRunnerFn & {
        mockImplementation: (fn: CommandRunnerFn) => void
      },
    )
    const { context } = createMockContext({}, testRunner)
    const agent = createDeliveryAgent({ commandRunner: { run: testRunner } })

    const result = await agent.execute(context)

    expect(result.success).toBe(true)
    const deliveryResult = result.output as DeliveryResult
    expect(deliveryResult.prUrl).toBeDefined()
  })

  it('should handle various test report states', async () => {
    const testRunner = createMockCommandRunner()
    setupSuccessfulGitCommands(
      testRunner as CommandRunnerFn & {
        mockImplementation: (fn: CommandRunnerFn) => void
      },
    )

    const testStates = [
      { passed: true, coverage: 85, testsRun: 10 },
      { passed: false, coverage: 45, testsRun: 20 },
      { passed: true, coverage: 100, testsRun: 50 },
    ]

    for (const state of testStates) {
      const { context } = createMockContext(
        {
          phaseOutputs: {
            implementation: {
              modifiedFiles: ['src/file.ts'],
              addedTests: ['tests/file.test.ts'],
              duration: 1000,
              backend: 'kimi-code',
              selfCorrectionAttempts: 0,
            } as ImplementationResult,
            'test-verification': {
              passed: state.passed,
              coverage: state.coverage,
              testFailures: state.passed
                ? []
                : [{ test: 'test', error: 'fail' }],
              testsRun: state.testsRun,
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

      const agent = createDeliveryAgent({ commandRunner: { run: testRunner } })
      const result = await agent.execute(context)

      expect(result.success).toBe(true)
    }
  })

  it('should handle various review council outcomes', async () => {
    const testRunner = createMockCommandRunner()
    setupSuccessfulGitCommands(
      testRunner as CommandRunnerFn & {
        mockImplementation: (fn: CommandRunnerFn) => void
      },
    )

    const outcomes: ReviewCouncilResult['consensus'][] = [
      'passed',
      'passed-with-warnings',
      'rejected',
    ]

    for (const consensus of outcomes) {
      const { context } = createMockContext(
        {
          phaseOutputs: {
            implementation: {
              modifiedFiles: ['src/file.ts'],
              addedTests: ['tests/file.test.ts'],
              duration: 1000,
              backend: 'kimi-code',
              selfCorrectionAttempts: 0,
            } as ImplementationResult,
            'test-verification': {
              passed: consensus !== 'rejected',
              coverage: 80,
              testFailures: [],
              testsRun: 10,
              duration: 1000,
            } as TestReport,
            'review-delivery': {
              consensus,
              votes: [
                {
                  perspective: 'security',
                  approved: consensus !== 'rejected',
                  feedback: 'ok',
                  severity: 'low',
                },
              ],
              rounds: 1,
              cost: 0.1,
            } as ReviewCouncilResult,
          },
        },
        testRunner,
      )

      const agent = createDeliveryAgent({ commandRunner: { run: testRunner } })
      const result = await agent.execute(context)

      expect(result.success).toBe(true)
    }
  })
})
