/**
 * Integration tests for configurable review council
 * Validates end-to-end behavior with custom reviewers and per-reviewer backends
 *
 * Requirements: 4.2, 6.1, 6.2, 7.1, 8.2, 11.3
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  ReviewCouncilAgent,
  createReviewCouncilAgent,
} from '@/agents/review-council'
import { EventBus } from '@/core/event-bus'
import { BackendRegistry } from '@/backends/backend-registry'
import type { AgentContext, ReviewCouncilResult } from '@/core/types'
import type { KASOConfig, ExecutorBackendConfig } from '@/config/schema'
import { getDefaultConfig } from '@/config/schema'
import type { ExecutionEvent } from '@/core/types'

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
  {
    name: 'gpt4-code',
    command: 'echo',
    args: [],
    protocol: 'cli-json',
    maxContextWindow: 128000,
    costPer1000Tokens: 0.03,
    enabled: true,
  },
]

function createTestConfig(reviewerConfig?: {
  reviewers?: Array<{ role: string; backend?: string }>
  perspectives?: ('security' | 'performance' | 'maintainability')[]
}): KASOConfig {
  const baseConfig = getDefaultConfig()
  return {
    ...baseConfig,
    executorBackends: TEST_BACKENDS,
    defaultBackend: 'kimi-code',
    backendSelectionStrategy: 'default',
    phaseBackends: {},
    reviewCouncil: {
      maxReviewRounds: 2,
      enableParallelReview: false,
      perspectives: ['security', 'performance', 'maintainability'],
      ...reviewerConfig,
    },
  }
}

function createMockContext(
  overrides: Partial<AgentContext> = {},
): AgentContext {
  const baseConfig = createTestConfig()
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
        modifiedFiles: ['src/auth/login.ts'],
        addedTests: ['tests/auth/login.test.ts'],
        duration: 5000,
        backend: 'kimi-code',
        selfCorrectionAttempts: 0,
      },
      'architecture-review': {
        approved: true,
        violations: [],
        modifiedFiles: ['src/auth/login.ts'],
      },
      'test-verification': {
        passed: true,
        coverage: 85,
        testFailures: [],
        testsRun: 10,
        duration: 2000,
      },
    },
    config: baseConfig,
    backends: {},
    ...overrides,
  }
}

interface TestContext {
  agent: ReviewCouncilAgent
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

  const backendRegistry = new BackendRegistry(config)

  // Register mock backends for testing
  for (const backend of config.executorBackends) {
    if (backend.enabled) {
      try {
        // Create mock backend with both getter methods and name property
        const mockBackend = {
          name: backend.name,
          getProtocol: () => backend.protocol,
          getMaxContextWindow: () => backend.maxContextWindow,
          getCostPer1000Tokens: () => backend.costPer1000Tokens,
          isAvailable: vi.fn(async () => true),
          execute: vi.fn(async () => ({
            id: 'test',
            success: true,
            output: {
              approved: true,
              feedback: 'LGTM',
              severity: 'low',
            },
            tokensUsed: 100,
          })),
          onProgress: vi.fn(),
        } as unknown as import('@/backends/backend-adapter').ExecutorBackend

        backendRegistry.registerBackend(backend.name, mockBackend, backend)
      } catch {
        // Backend may already be registered
      }
    }
  }

  const agent = createReviewCouncilAgent({
    eventBus,
    backendRegistry,
  })

  return { agent, eventBus, backendRegistry, events }
}

// ============================================================================
// Integration Tests
// ============================================================================

describe('Review Council Custom Reviewers Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should execute with custom reviewer roles', async () => {
    const config = createTestConfig({
      reviewers: [
        { role: 'security' },
        { role: 'accessibility' },
        { role: 'compliance' },
      ],
    })
    const { agent } = setupTest(config)

    const context = createMockContext({ config })
    const result = await agent.execute(context)

    expect(result.success).toBe(true)
    expect(result.output).toBeDefined()

    const councilResult = result.output as ReviewCouncilResult
    expect(councilResult.votes.length).toBe(3)

    // Verify custom perspectives are in votes
    const perspectives = councilResult.votes.map((v) => v.perspective)
    expect(perspectives).toContain('security')
    expect(perspectives).toContain('accessibility')
    expect(perspectives).toContain('compliance')
  })

  it('should use per-reviewer backend when specified', async () => {
    const config = createTestConfig({
      reviewers: [
        { role: 'security', backend: 'claude-code' },
        { role: 'performance', backend: 'gpt4-code' },
        { role: 'maintainability' }, // uses default
      ],
    })
    const { agent, events } = setupTest(config)

    const context = createMockContext({ config })
    await agent.execute(context)

    // Find reviewer-override events
    const reviewerOverrideEvents = events.filter(
      (e: import('@/core/types').ExecutionEvent) =>
        e.type === 'agent:backend-selected' &&
        e.data?.reason === 'reviewer-override',
    )

    expect(reviewerOverrideEvents.length).toBe(2)

    // Verify reviewer-override events have correct roles
    const securityEvent = reviewerOverrideEvents.find(
      (e: import('@/core/types').ExecutionEvent) =>
        e.data?.reviewerRole === 'security',
    )
    expect(securityEvent).toBeDefined()
    expect(securityEvent?.data?.backend).toBeDefined()

    const performanceEvent = reviewerOverrideEvents.find(
      (e: import('@/core/types').ExecutionEvent) =>
        e.data?.reviewerRole === 'performance',
    )
    expect(performanceEvent).toBeDefined()
    expect(performanceEvent?.data?.backend).toBeDefined()
  })

  it('should fall back to default backend when no reviewer backend specified', async () => {
    const config = createTestConfig({
      reviewers: [{ role: 'security' }],
    })
    const { agent, events } = setupTest(config)

    const context = createMockContext({ config })
    await agent.execute(context)

    // Should not have reviewer-override event (no explicit backend)
    const reviewerOverrideEvents = events.filter(
      (e: import('@/core/types').ExecutionEvent) =>
        e.type === 'agent:backend-selected' &&
        e.data?.reason === 'reviewer-override',
    )

    expect(reviewerOverrideEvents.length).toBe(0)
  })

  it('should determine consensus correctly with variable reviewer counts', async () => {
    // Test with 1 reviewer
    const singleReviewerConfig = createTestConfig({
      reviewers: [{ role: 'security' }],
    })
    const { agent: singleAgent } = setupTest(singleReviewerConfig)
    const singleResult = await singleAgent.execute(
      createMockContext({ config: singleReviewerConfig }),
    )
    expect(singleResult.success).toBe(true)

    // Test with 2 reviewers
    const twoReviewerConfig = createTestConfig({
      reviewers: [{ role: 'security' }, { role: 'performance' }],
    })
    const { agent: twoAgent } = setupTest(twoReviewerConfig)
    const twoResult = await twoAgent.execute(
      createMockContext({ config: twoReviewerConfig }),
    )
    expect(twoResult.success).toBe(true)

    // Test with 4 reviewers
    const fourReviewerConfig = createTestConfig({
      reviewers: [
        { role: 'security' },
        { role: 'performance' },
        { role: 'maintainability' },
        { role: 'accessibility' },
      ],
    })
    const { agent: fourAgent } = setupTest(fourReviewerConfig)
    const fourResult = await fourAgent.execute(
      createMockContext({ config: fourReviewerConfig }),
    )
    expect(fourResult.success).toBe(true)

    const councilResult = fourResult.output as ReviewCouncilResult
    expect(councilResult.votes.length).toBe(4)
  })

  it('should use custom perspectives in votes', async () => {
    const customRoles = [
      'security',
      'scalability',
      'compliance',
      'testing-quality',
    ]
    const config = createTestConfig({
      reviewers: customRoles.map((role) => ({ role })),
    })
    const { agent } = setupTest(config)

    const context = createMockContext({ config })
    const result = await agent.execute(context)

    expect(result.success).toBe(true)
    const councilResult = result.output as ReviewCouncilResult

    // Verify all custom roles are present in votes
    const perspectives = councilResult.votes.map((v) => v.perspective)
    for (const role of customRoles) {
      expect(perspectives).toContain(role)
    }
  })

  it('should emit backend-selected event with reviewer role', async () => {
    const config = createTestConfig({
      reviewers: [
        { role: 'security', backend: 'claude-code' },
        { role: 'compliance', backend: 'gpt4-code' },
      ],
    })
    const { agent, events } = setupTest(config)

    const context = createMockContext({ config })
    await agent.execute(context)

    const reviewerEvents = events.filter(
      (e: import('@/core/types').ExecutionEvent) =>
        e.type === 'agent:backend-selected' &&
        e.data?.reason === 'reviewer-override',
    )

    expect(reviewerEvents.length).toBe(2)

    // Verify each event has reviewerRole
    for (const event of reviewerEvents) {
      expect(event.data?.reviewerRole).toBeDefined()
      expect(['security', 'compliance']).toContain(event.data?.reviewerRole)
    }
  })

  it('should use legacy perspectives when reviewers not provided', async () => {
    const config = createTestConfig({
      perspectives: ['security', 'performance', 'maintainability'] as (
        | 'security'
        | 'performance'
        | 'maintainability'
      )[],
    })
    const { agent } = setupTest(config)

    const context = createMockContext({ config })
    const result = await agent.execute(context)

    expect(result.success).toBe(true)
    const councilResult = result.output as ReviewCouncilResult

    // Should have 3 votes for the 3 perspectives
    expect(councilResult.votes.length).toBe(3)

    const perspectives = councilResult.votes.map((v) => v.perspective)
    expect(perspectives).toContain('security')
    expect(perspectives).toContain('performance')
    expect(perspectives).toContain('maintainability')
  })
})
