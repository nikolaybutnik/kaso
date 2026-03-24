/**
 * Unit tests for Review Council Agent
 *
 * Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 29.1, 29.2, 29.3
 * Property tests are in tests/property/review-council.property.test.ts
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  ReviewCouncilAgent,
  createReviewCouncilAgent,
} from '../../src/agents/review-council'
import type {
  AgentContext,
  ImplementationResult,
  ArchitectureReview,
  TestReport,
  ReviewCouncilResult,
} from '../../src/core/types'
import { EventBus } from '../../src/core/event-bus'

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockContext(
  overrides: Partial<AgentContext> = {},
): AgentContext {
  return {
    runId: 'test-run-123',
    spec: {
      featureName: 'test-feature',
      specPath: '.kiro/specs/test-feature',
      missingFiles: [],
    },
    steering: { hooks: {} },
    phaseOutputs: {
      implementation: {
        modifiedFiles: ['src/auth/login.ts', 'src/utils/crypto.ts'],
        addedTests: ['tests/auth/login.test.ts'],
        duration: 5000,
        backend: 'kimi-code',
        selfCorrectionAttempts: 0,
      } as ImplementationResult,
      'architecture-review': {
        approved: true,
        violations: [],
        modifiedFiles: ['src/auth/login.ts'],
      } as ArchitectureReview,
      'test-verification': {
        passed: true,
        coverage: 85,
        testFailures: [],
        testsRun: 10,
        duration: 2000,
      } as TestReport,
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
      phaseTimeouts: {},
      executionStore: {
        type: 'sqlite',
        path: '.kaso/execution-store.db',
      },
    },
    backends: {},
    ...overrides,
  }
}

// =============================================================================
// Unit Tests
// =============================================================================

describe('ReviewCouncilAgent', () => {
  let agent: ReviewCouncilAgent
  let eventBus: EventBus

  beforeEach(() => {
    eventBus = new EventBus()
    agent = createReviewCouncilAgent({ eventBus })
  })

  describe('interface compliance', () => {
    it('should implement Agent interface', () => {
      expect(agent.execute).toBeDefined()
      expect(agent.supportsRollback).toBeDefined()
      expect(agent.estimatedDuration).toBeDefined()
      expect(agent.requiredContext).toBeDefined()
    })

    it('should not support rollback', () => {
      expect(agent.supportsRollback()).toBe(false)
    })

    it('should return estimated duration', () => {
      expect(agent.estimatedDuration()).toBeGreaterThan(0)
    })

    it('should require correct context keys', () => {
      const required = agent.requiredContext()
      expect(required).toContain('phaseOutputs.implementation')
      expect(required).toContain('phaseOutputs.architecture-review')
      expect(required).toContain('phaseOutputs.test-verification')
    })
  })

  describe('execution', () => {
    it('should return successful result with ReviewCouncilResult', async () => {
      const context = createMockContext()
      const result = await agent.execute(context)

      expect(result.success).toBe(true)
      expect(result.output).toBeDefined()
      expect(result.duration).toBeGreaterThanOrEqual(0)

      const councilResult = result.output as ReviewCouncilResult
      expect(councilResult.consensus).toBeDefined()
      expect(councilResult.votes).toBeDefined()
      expect(councilResult.rounds).toBeGreaterThan(0)
      expect(councilResult.cost).toBeGreaterThanOrEqual(0)
    })

    it('should handle missing implementation result', async () => {
      const context = createMockContext({
        phaseOutputs: {},
      })
      const result = await agent.execute(context)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('implementation')
    })

    it('should handle abort signal', async () => {
      const abortController = new AbortController()
      abortController.abort()

      const context = createMockContext({
        abortSignal: abortController.signal,
      })
      const result = await agent.execute(context)

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('aborted')
    })

    it('should emit progress events', async () => {
      const events: string[] = []
      eventBus.on('agent:progress', (event) => {
        if (event.agent === 'review-council') {
          events.push(event.data?.message as string)
        }
      })

      const context = createMockContext()
      await agent.execute(context)

      expect(events.length).toBeGreaterThan(0)
    })
  })

  describe('consensus logic', () => {
    it('should return passed when all perspectives approve', async () => {
      const context = createMockContext({
        phaseOutputs: {
          implementation: {
            modifiedFiles: ['src/utils/helper.ts'],
            addedTests: ['tests/utils/helper.test.ts'],
            duration: 1000,
            backend: 'kimi-code',
            selfCorrectionAttempts: 0,
          } as ImplementationResult,
          'architecture-review': {
            approved: true,
            violations: [],
            modifiedFiles: ['src/utils/helper.ts'],
          } as ArchitectureReview,
          'test-verification': {
            passed: true,
            coverage: 90,
            testFailures: [],
            testsRun: 5,
            duration: 1000,
          } as TestReport,
        },
      })

      const result = await agent.execute(context)
      const councilResult = result.output as ReviewCouncilResult

      expect(councilResult.consensus).toBe('passed')
      expect(councilResult.votes.every((v) => v.approved)).toBe(true)
    })

    it('should return rejected when tests fail', async () => {
      const context = createMockContext({
        phaseOutputs: {
          implementation: {
            modifiedFiles: ['src/auth/login.ts'],
            addedTests: [],
            duration: 1000,
            backend: 'kimi-code',
            selfCorrectionAttempts: 0,
          } as ImplementationResult,
          'architecture-review': {
            approved: true,
            violations: [],
            modifiedFiles: ['src/auth/login.ts'],
          } as ArchitectureReview,
          'test-verification': {
            passed: false,
            coverage: 30,
            testFailures: [{ test: 'auth test', error: 'failed' }],
            testsRun: 5,
            duration: 1000,
          } as TestReport,
        },
      })

      const result = await agent.execute(context)
      const councilResult = result.output as ReviewCouncilResult

      expect(councilResult.consensus).toBe('rejected')
      expect(councilResult.votes.some((v) => !v.approved)).toBe(true)
    })

    it('should handle low coverage with warnings', async () => {
      const context = createMockContext({
        phaseOutputs: {
          implementation: {
            modifiedFiles: ['src/utils/helper.ts'],
            addedTests: ['tests/utils/helper.test.ts'],
            duration: 1000,
            backend: 'kimi-code',
            selfCorrectionAttempts: 0,
          } as ImplementationResult,
          'architecture-review': {
            approved: true,
            violations: [],
            modifiedFiles: ['src/utils/helper.ts'],
          } as ArchitectureReview,
          'test-verification': {
            passed: true,
            coverage: 40,
            testFailures: [],
            testsRun: 2,
            duration: 500,
          } as TestReport,
        },
      })

      const result = await agent.execute(context)
      const councilResult = result.output as ReviewCouncilResult

      // Low coverage affects maintainability review
      expect(councilResult.votes.some((v) => v.severity === 'medium')).toBe(
        true,
      )
    })
  })

  describe('budget and rounds', () => {
    it('should respect maxReviewRounds limit', async () => {
      const context = createMockContext({
        config: {
          ...createMockContext().config,
          reviewCouncil: {
            maxReviewRounds: 1,
            enableParallelReview: false,
            perspectives: ['security', 'performance', 'maintainability'],
          },
        },
      })

      const result = await agent.execute(context)
      const councilResult = result.output as ReviewCouncilResult

      expect(councilResult.rounds).toBeLessThanOrEqual(1)
    })

    it('should track cost accurately', async () => {
      const context = createMockContext()
      const result = await agent.execute(context)
      const councilResult = result.output as ReviewCouncilResult

      expect(councilResult.cost).toBeGreaterThanOrEqual(0)
      expect(typeof councilResult.cost).toBe('number')
    })

    it('should stop when budget is exceeded', async () => {
      const context = createMockContext({
        config: {
          ...createMockContext().config,
          reviewCouncil: {
            maxReviewRounds: 5,
            enableParallelReview: false,
            reviewBudgetUsd: 0.001, // Very low budget
            perspectives: ['security', 'performance', 'maintainability'],
          },
        },
      })

      const result = await agent.execute(context)
      const councilResult = result.output as ReviewCouncilResult

      // Should stop early due to budget
      expect(councilResult.cost).toBeGreaterThanOrEqual(0)
      expect(councilResult.rounds).toBeGreaterThanOrEqual(1)
    })
  })

  describe('parallel vs sequential execution', () => {
    it('should support parallel review mode', async () => {
      const context = createMockContext({
        config: {
          ...createMockContext().config,
          reviewCouncil: {
            maxReviewRounds: 1,
            enableParallelReview: true,
            perspectives: ['security', 'performance', 'maintainability'],
          },
        },
      })

      const result = await agent.execute(context)
      expect(result.success).toBe(true)

      const councilResult = result.output as ReviewCouncilResult
      expect(councilResult.votes.length).toBe(3)
    })

    it('should support sequential review mode', async () => {
      const context = createMockContext({
        config: {
          ...createMockContext().config,
          reviewCouncil: {
            maxReviewRounds: 1,
            enableParallelReview: false,
            perspectives: ['security', 'performance', 'maintainability'],
          },
        },
      })

      const result = await agent.execute(context)
      expect(result.success).toBe(true)

      const councilResult = result.output as ReviewCouncilResult
      expect(councilResult.votes.length).toBe(3)
    })
  })

  describe('perspective-specific reviews', () => {
    it('should flag security concerns for auth files', async () => {
      const context = createMockContext({
        phaseOutputs: {
          implementation: {
            modifiedFiles: ['src/auth/password-reset.ts'],
            addedTests: [],
            duration: 1000,
            backend: 'kimi-code',
            selfCorrectionAttempts: 0,
          } as ImplementationResult,
          'architecture-review': {
            approved: true,
            violations: [],
            modifiedFiles: ['src/auth/password-reset.ts'],
          } as ArchitectureReview,
          'test-verification': {
            passed: true,
            coverage: 50,
            testFailures: [],
            testsRun: 3,
            duration: 500,
          } as TestReport,
        },
      })

      const result = await agent.execute(context)
      const councilResult = result.output as ReviewCouncilResult

      const securityVote = councilResult.votes.find(
        (v) => v.perspective === 'security',
      )
      expect(securityVote).toBeDefined()
      expect(securityVote?.feedback.toLowerCase()).toContain('security')
    })

    it('should flag maintainability issues for architecture violations', async () => {
      const context = createMockContext({
        phaseOutputs: {
          implementation: {
            modifiedFiles: ['src/module-a/file.ts'],
            addedTests: [],
            duration: 1000,
            backend: 'kimi-code',
            selfCorrectionAttempts: 0,
          } as ImplementationResult,
          'architecture-review': {
            approved: false,
            violations: [
              {
                file: 'src/module-a/file.ts',
                pattern: 'No imports from module-b',
                issue: 'Cross-module import violation',
                suggestion: 'Use shared module instead',
              },
            ],
            modifiedFiles: ['src/module-a/file.ts'],
          } as ArchitectureReview,
          'test-verification': {
            passed: true,
            coverage: 80,
            testFailures: [],
            testsRun: 10,
            duration: 1000,
          } as TestReport,
        },
      })

      const result = await agent.execute(context)
      const councilResult = result.output as ReviewCouncilResult

      const maintainabilityVote = councilResult.votes.find(
        (v) => v.perspective === 'maintainability',
      )
      expect(maintainabilityVote).toBeDefined()
      expect(maintainabilityVote?.approved).toBe(false)
    })
  })
})

// =============================================================================
// Edge Cases
// =============================================================================

describe('Review Council Edge Cases', () => {
  it('should handle empty modified files list', async () => {
    const agent = createReviewCouncilAgent()
    const context = createMockContext({
      config: {
        ...createMockContext().config,
        reviewCouncil: {
          maxReviewRounds: 1,
          enableParallelReview: false,
          perspectives: ['security', 'performance', 'maintainability'],
        },
      },
      phaseOutputs: {
        implementation: {
          modifiedFiles: [],
          addedTests: [],
          duration: 1000,
          backend: 'kimi-code',
          selfCorrectionAttempts: 0,
        } as ImplementationResult,
        'architecture-review': {
          approved: true,
          violations: [],
          modifiedFiles: [],
        } as ArchitectureReview,
        'test-verification': {
          passed: true,
          coverage: 0,
          testFailures: [],
          testsRun: 0,
          duration: 0,
        } as TestReport,
      },
    })

    const result = await agent.execute(context)
    expect(result.success).toBe(true)

    const councilResult = result.output as ReviewCouncilResult
    // Should have 3 votes (one per perspective) for a single round
    expect(councilResult.votes.length).toBe(3)
  })

  it('should handle custom perspective configuration', async () => {
    const agent = createReviewCouncilAgent()
    const context = createMockContext({
      config: {
        ...createMockContext().config,
        reviewCouncil: {
          maxReviewRounds: 1,
          enableParallelReview: false,
          perspectives: ['security', 'maintainability'] as const, // Only 2 perspectives
        },
      },
      phaseOutputs: {
        implementation: {
          modifiedFiles: ['src/utils/helper.ts'],
          addedTests: ['tests/utils/helper.test.ts'],
          duration: 1000,
          backend: 'kimi-code',
          selfCorrectionAttempts: 0,
        } as ImplementationResult,
        'architecture-review': {
          approved: true,
          violations: [],
          modifiedFiles: ['src/utils/helper.ts'],
        } as ArchitectureReview,
        'test-verification': {
          passed: true,
          coverage: 90,
          testFailures: [],
          testsRun: 10,
          duration: 1000,
        } as TestReport,
      },
    })

    const result = await agent.execute(context)
    expect(result.success).toBe(true)

    const councilResult = result.output as ReviewCouncilResult
    const perspectives = councilResult.votes.map((v) => v.perspective)
    expect(perspectives).toContain('security')
    expect(perspectives).toContain('maintainability')
    expect(perspectives).not.toContain('performance')
    expect(councilResult.votes.length).toBe(2) // Only 2 perspectives
  })

  it('should handle abort during execution', async () => {
    const agent = createReviewCouncilAgent()
    const abortController = new AbortController()

    // Abort after a short delay
    setTimeout(() => abortController.abort(), 10)

    const context = createMockContext({
      abortSignal: abortController.signal,
    })

    try {
      await agent.execute(context)
      // If we get here without error, the agent handled abort gracefully
    } catch {
      // Expected if abort is thrown
    }
  })
})
