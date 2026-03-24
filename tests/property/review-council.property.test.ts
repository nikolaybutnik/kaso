/**
 * Property tests for Review Council Agent
 *
 * Property 27: Review Council spawns 3 perspective-specific reviewers and collects all votes
 * Property 28: Review consensus determined by approval count
 * Property 58: Review council cost control
 *
 * Validates: Requirements 15.1, 15.2, 15.3, 15.4, 15.5, 29.1, 29.2, 29.3
 */

import { test, fc } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { createReviewCouncilAgent } from '../../src/agents/review-council'
import type {
  AgentContext,
  ImplementationResult,
  ArchitectureReview,
  TestReport,
  ReviewCouncilResult,
} from '../../src/core/types'
import { EventBus } from '../../src/core/event-bus'

// =============================================================================
// Shared Fixtures
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
// Arbitraries
// =============================================================================

/** Arbitrary for generating random file paths */
const arbFilePath = fc
  .array(
    fc
      .string({ minLength: 1, maxLength: 12 })
      .map((s) => s.replace(/[^a-z-]/g, 'x') || 'file'),
    { minLength: 1, maxLength: 4 },
  )
  .map((parts) => `src/${parts.join('/')}.ts`)

/** Arbitrary for generating random architecture violations */
const arbViolation = fc.record({
  file: arbFilePath,
  pattern: fc.string({ minLength: 1, maxLength: 30 }),
  issue: fc.string({ minLength: 1, maxLength: 50 }),
  suggestion: fc.string({ minLength: 1, maxLength: 50 }),
})

/** Arbitrary for generating a random review context via phaseOutputs */
const arbPhaseOutputs = fc.record({
  modifiedFiles: fc.array(arbFilePath, { minLength: 1, maxLength: 8 }),
  addedTests: fc.array(arbFilePath, { minLength: 0, maxLength: 5 }),
  testPassed: fc.boolean(),
  coverage: fc.float({ min: 0, max: 100, noNaN: true }),
  violations: fc.array(arbViolation, { minLength: 0, maxLength: 3 }),
  testsRun: fc.integer({ min: 0, max: 100 }),
})

interface ArbPhaseOutputs {
  modifiedFiles: string[]
  addedTests: string[]
  testPassed: boolean
  coverage: number
  violations: Array<{
    file: string
    pattern: string
    issue: string
    suggestion: string
  }>
  testsRun: number
}

function buildContextFromArb(arb: ArbPhaseOutputs): AgentContext {
  return createMockContext({
    phaseOutputs: {
      implementation: {
        modifiedFiles: arb.modifiedFiles,
        addedTests: arb.addedTests,
        duration: 1000,
        backend: 'kimi-code',
        selfCorrectionAttempts: 0,
      } as ImplementationResult,
      'architecture-review': {
        approved: arb.violations.length === 0,
        violations: arb.violations,
        modifiedFiles: arb.modifiedFiles,
      } as ArchitectureReview,
      'test-verification': {
        passed: arb.testPassed,
        coverage: arb.coverage,
        testFailures: arb.testPassed ? [] : [{ test: 'test', error: 'fail' }],
        testsRun: arb.testsRun,
        duration: 1000,
      } as TestReport,
    },
  })
}

// =============================================================================
// Property Tests
// =============================================================================

describe('Property 27: Review Council spawns 3 perspective-specific reviewers', () => {
  /**
   * For any arbitrary set of modified files, test results, and architecture violations,
   * the review council SHALL always produce exactly 3 votes — one per perspective.
   * Validates: Requirement 15.1
   */
  test.prop([arbPhaseOutputs])(
    'always produces exactly 3 unique perspective votes for any input',
    async (arb) => {
      const agent = createReviewCouncilAgent({ eventBus: new EventBus() })
      const context = buildContextFromArb(arb)
      const result = await agent.execute(context)

      expect(result.output).toBeDefined()
      const councilResult = result.output as ReviewCouncilResult

      // Must always have exactly 3 unique perspective votes
      const perspectives = new Set(
        councilResult.votes.map((v) => v.perspective),
      )
      expect(perspectives.size).toBe(3)
      expect(perspectives.has('security')).toBe(true)
      expect(perspectives.has('performance')).toBe(true)
      expect(perspectives.has('maintainability')).toBe(true)

      // Every vote must have required fields
      for (const vote of councilResult.votes) {
        expect(typeof vote.approved).toBe('boolean')
        expect(vote.feedback.length).toBeGreaterThan(0)
        expect(['high', 'medium', 'low']).toContain(vote.severity)
      }
    },
  )

  test.prop([arbPhaseOutputs, fc.boolean()])(
    'produces votes for all perspectives in both parallel and sequential modes',
    async (arb, parallel) => {
      const agent = createReviewCouncilAgent({ eventBus: new EventBus() })
      const context = buildContextFromArb(arb)
      context.config = {
        ...context.config,
        reviewCouncil: {
          ...context.config.reviewCouncil,
          enableParallelReview: parallel,
        },
      }

      const result = await agent.execute(context)
      const councilResult = result.output as ReviewCouncilResult

      const perspectives = new Set(
        councilResult.votes.map((v) => v.perspective),
      )
      expect(perspectives.size).toBe(3)
    },
  )
})

describe('Property 28: Review consensus determined by approval count', () => {
  /**
   * For any combination of inputs, the consensus SHALL be:
   *   3/3 approved → 'passed'
   *   2/3 approved → 'passed-with-warnings'
   *   <2/3 approved → 'rejected'
   * Validates: Requirements 15.2, 15.3, 15.4
   */
  test.prop([arbPhaseOutputs])(
    'consensus matches approval count invariant for any input',
    async (arb) => {
      const agent = createReviewCouncilAgent({ eventBus: new EventBus() })
      const context = buildContextFromArb(arb)
      const result = await agent.execute(context)

      const councilResult = result.output as ReviewCouncilResult

      // Take latest vote per perspective (same logic as implementation)
      const latestVotes = new Map<string, boolean>()
      for (const vote of councilResult.votes) {
        latestVotes.set(vote.perspective, vote.approved)
      }
      const approvalCount = Array.from(latestVotes.values()).filter(
        Boolean,
      ).length
      const totalCount = latestVotes.size

      if (approvalCount === totalCount) {
        expect(councilResult.consensus).toBe('passed')
      } else if (approvalCount >= 2) {
        expect(councilResult.consensus).toBe('passed-with-warnings')
      } else {
        expect(councilResult.consensus).toBe('rejected')
      }
    },
  )

  test.prop([arbPhaseOutputs])(
    'consensus is always one of the three valid values',
    async (arb) => {
      const agent = createReviewCouncilAgent({ eventBus: new EventBus() })
      const context = buildContextFromArb(arb)
      const result = await agent.execute(context)

      const councilResult = result.output as ReviewCouncilResult
      expect(['passed', 'passed-with-warnings', 'rejected']).toContain(
        councilResult.consensus,
      )
    },
  )
})

describe('Property 58: Review council cost control', () => {
  /**
   * For any budget and maxRounds configuration:
   *   - rounds SHALL never exceed maxRounds
   *   - cost SHALL be non-negative
   *   - at least 1 round SHALL always execute
   * Validates: Requirements 15.5, 29.1, 29.2, 29.3
   */
  test.prop([
    fc.float({ min: Math.fround(0.001), max: Math.fround(10.0), noNaN: true }),
    fc.integer({ min: 1, max: 5 }),
    fc.boolean(),
  ])(
    'rounds never exceed maxRounds and cost stays non-negative',
    async (budgetUsd, maxRounds, parallel) => {
      const agent = createReviewCouncilAgent({ eventBus: new EventBus() })
      const context = createMockContext({
        config: {
          ...createMockContext().config,
          reviewCouncil: {
            maxReviewRounds: maxRounds,
            enableParallelReview: parallel,
            reviewBudgetUsd: budgetUsd,
            perspectives: ['security', 'performance', 'maintainability'],
          },
        },
      })

      const result = await agent.execute(context)
      const councilResult = result.output as ReviewCouncilResult

      expect(councilResult.rounds).toBeLessThanOrEqual(maxRounds)
      expect(councilResult.rounds).toBeGreaterThanOrEqual(1)
      expect(councilResult.cost).toBeGreaterThanOrEqual(0)
    },
  )

  test.prop([fc.integer({ min: 1, max: 5 })])(
    'without budget cap, rounds are bounded only by maxRounds',
    async (maxRounds) => {
      const agent = createReviewCouncilAgent({ eventBus: new EventBus() })
      const context = createMockContext({
        config: {
          ...createMockContext().config,
          reviewCouncil: {
            maxReviewRounds: maxRounds,
            enableParallelReview: false,
            perspectives: ['security', 'performance', 'maintainability'],
          },
        },
      })

      const result = await agent.execute(context)
      const councilResult = result.output as ReviewCouncilResult

      expect(councilResult.rounds).toBeLessThanOrEqual(maxRounds)
      expect(councilResult.rounds).toBeGreaterThanOrEqual(1)
      expect(councilResult.cost).toBeGreaterThanOrEqual(0)
    },
  )
})
