/**
 * Property tests for Error Handling and Recovery (Task 14.2, 14.4)
 * Validates: Requirements 16.1, 16.2, 16.3, 16.5, 16.6
 */

import { test, fc } from '@fast-check/vitest'
import { describe, expect, vi } from 'vitest'
import { ErrorHandler } from '@/core/error-handler'
import type { BackendRegistry } from '@/backends/backend-registry'
import type { Agent } from '@/agents/agent-interface'
import type { KASOConfig } from '@/config/schema'
import type { PhaseName, AgentError } from '@/core/types'

// ============================================================================
// Mock factories
// ============================================================================

function createMockBackendRegistry(): BackendRegistry {
  return {
    getBackend: vi.fn(),
    selectBackend: vi.fn(),
    listBackends: vi.fn(() => ['backend-1', 'backend-2']),
    getConfig: vi.fn((name: string) =>
      name === 'backend-2'
        ? {
            name: 'backend-2',
            command: 'echo',
            args: [],
            protocol: 'cli-json' as const,
            maxContextWindow: 64000,
            costPer1000Tokens: 0.005,
            enabled: true,
          }
        : {
            name: 'backend-1',
            command: 'echo',
            args: [],
            protocol: 'cli-json' as const,
            maxContextWindow: 128000,
            costPer1000Tokens: 0.01,
            enabled: true,
          },
    ),
    getDefaultBackendName: vi.fn(() => 'backend-1'),
    getSelectionStrategy: vi.fn(() => 'default' as const),
    isBackendAvailable: vi.fn(async () => true),
  } as unknown as BackendRegistry
}

function createTestConfig(overrides: Partial<KASOConfig> = {}): KASOConfig {
  return {
    executorBackends: [
      {
        name: 'backend-1',
        command: 'echo',
        args: [],
        protocol: 'cli-json',
        maxContextWindow: 128000,
        costPer1000Tokens: 0.01,
        enabled: true,
      },
    ],
    defaultBackend: 'backend-1',
    backendSelectionStrategy: 'default',
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

function createRollbackAgent(): Agent {
  return {
    execute: vi.fn(),
    supportsRollback: () => true,
    estimatedDuration: () => 1000,
    requiredContext: () => [],
  }
}

function createNonRollbackAgent(): Agent {
  return {
    execute: vi.fn(),
    supportsRollback: () => false,
    estimatedDuration: () => 1000,
    requiredContext: () => [],
  }
}

function createRetryableError(message = 'Test error'): AgentError {
  return { message, retryable: true }
}

function createSecurityError(
  message = 'Security vulnerability detected',
): AgentError {
  return { message, retryable: true }
}

function createArchitecturalError(
  message = 'Architectural deadlock detected',
): AgentError {
  return { message, retryable: true }
}

// ============================================================================
// Property Tests
// ============================================================================

describe('Error Handling Properties', () => {
  /**
   * Property 31: Rollback triggered for rollback-capable agents on failure
   * Validates: Requirement 16.1
   */
  test.prop([fc.string({ minLength: 5, maxLength: 20 })], { numRuns: 10 })(
    'Property 31: Rollback is triggered for agents that support rollback on failure',
    (runId) => {
      const config = createTestConfig()
      const backendRegistry = createMockBackendRegistry()
      const errorHandler = new ErrorHandler(backendRegistry, config)

      const rollbackAgent = createRollbackAgent()
      const nonRollbackAgent = createNonRollbackAgent()
      const phase: PhaseName = 'implementation'
      const error = createRetryableError()

      // Rollback agent should suggest rollback-retry
      const rollbackResult = errorHandler.handleFailure(
        runId,
        phase,
        error,
        rollbackAgent,
      )
      expect(rollbackResult.action).toBe('rollback-retry')
      expect(rollbackResult.reason).toContain('Rolling back')

      // Non-rollback agent should suggest standard retry
      const nonRollbackResult = errorHandler.handleFailure(
        runId,
        phase,
        error,
        nonRollbackAgent,
      )
      expect(nonRollbackResult.action).toBe('retry')
    },
  )

  /**
   * Property 32: Phase retry capped at 2 additional attempts
   * Validates: Requirement 16.2
   */
  test.prop(
    [
      fc.string({ minLength: 1, maxLength: 20 }),
      fc.integer({ min: 0, max: 4 }), // Initial retry count
    ],
    { numRuns: 10 },
  )(
    'Property 32: Phase retry is capped at maxPhaseRetries additional attempts',
    (runId, initialRetryCount) => {
      const maxRetries = 2
      const config = createTestConfig({ maxPhaseRetries: maxRetries })
      const backendRegistry = createMockBackendRegistry()
      const errorHandler = new ErrorHandler(backendRegistry, config)

      const agent = createNonRollbackAgent()
      const phase: PhaseName = 'implementation'

      // Simulate initial failures to build up retry count
      for (let i = 0; i < initialRetryCount; i++) {
        errorHandler.handleFailure(runId, phase, createRetryableError(), agent)
      }

      const state = errorHandler.getRetryState(runId, phase)
      // Count is capped at maxRetries because escalation happens when count >= maxRetries
      const expectedCount = Math.min(initialRetryCount, maxRetries)
      expect(state.count).toBe(expectedCount)

      // Check if we've exceeded max retries (escalation happens when count >= maxRetries)
      if (state.count >= maxRetries) {
        const result = errorHandler.handleFailure(
          runId,
          phase,
          createRetryableError(),
          agent,
        )
        expect(result.action).toBe('escalate')
      } else {
        const result = errorHandler.handleFailure(
          runId,
          phase,
          createRetryableError(),
          agent,
        )
        expect(result.action).toBe('retry')
      }
    },
  )

  /**
   * Property 33: Three consecutive failures trigger escalation
   * Validates: Requirement 16.3
   */
  test.prop([fc.string({ minLength: 5, maxLength: 20 })], { numRuns: 10 })(
    'Property 33: Three consecutive failures trigger escalation with detailed report',
    (runId) => {
      const config = createTestConfig({ maxPhaseRetries: 2 }) // 1 initial + 2 retries = 3 total
      const backendRegistry = createMockBackendRegistry()
      const errorHandler = new ErrorHandler(backendRegistry, config)

      const agent = createNonRollbackAgent()
      const phase: PhaseName = 'implementation'

      // First failure - should retry
      const result1 = errorHandler.handleFailure(
        runId,
        phase,
        createRetryableError('Attempt 1'),
        agent,
      )
      expect(result1.action).toBe('retry')
      expect(result1.modifiedContext?.retryCount).toBe(1)

      // Second failure - should retry with modified strategy
      const result2 = errorHandler.handleFailure(
        runId,
        phase,
        createRetryableError('Attempt 2'),
        agent,
      )
      expect(result2.action).toBe('retry')
      expect(result2.modifiedContext?.retryCount).toBe(2)

      // Third failure - should escalate (max retries exceeded)
      const result3 = errorHandler.handleFailure(
        runId,
        phase,
        createRetryableError('Attempt 3'),
        agent,
      )
      expect(result3.action).toBe('escalate')
      expect(result3.reason).toContain('failed after')
    },
  )

  /**
   * Property 34: Security concerns trigger immediate escalation
   * Validates: Requirement 16.5
   */
  test.prop([fc.string({ minLength: 5, maxLength: 20 })], { numRuns: 10 })(
    'Property 34: Security concerns trigger immediate escalation without retries',
    (runId) => {
      const config = createTestConfig({ maxPhaseRetries: 2 })
      const backendRegistry = createMockBackendRegistry()
      const errorHandler = new ErrorHandler(backendRegistry, config)

      const agent = createNonRollbackAgent()
      const phase: PhaseName = 'implementation'

      // Security error should escalate immediately, even on first failure
      const securityError = createSecurityError(
        'XSS vulnerability detected in user input',
      )
      const result = errorHandler.handleFailure(
        runId,
        phase,
        securityError,
        agent,
      )

      expect(result.action).toBe('escalate')
      expect(result.reason).toContain('Security')
      expect(result.modifiedContext?.retryCount).toBe(0)
    },
  )

  /**
   * Property 34b: Architectural deadlock triggers immediate escalation
   * Validates: Requirement 16.5
   */
  test.prop([fc.string({ minLength: 5, maxLength: 20 })], { numRuns: 10 })(
    'Property 34b: Architectural deadlock triggers immediate escalation',
    (runId) => {
      const config = createTestConfig({ maxPhaseRetries: 2 })
      const backendRegistry = createMockBackendRegistry()
      const errorHandler = new ErrorHandler(backendRegistry, config)

      const agent = createNonRollbackAgent()
      const phase: PhaseName = 'implementation'

      // Architectural error should escalate immediately
      const archError = createArchitecturalError(
        'Circular dependency detected between modules',
      )
      const result = errorHandler.handleFailure(runId, phase, archError, agent)

      expect(result.action).toBe('escalate')
      expect(result.reason).toContain('Architectural')
    },
  )
})

describe('Error Classification Properties', () => {
  test.prop([fc.string()], { numRuns: 20 })(
    'Security-related errors are classified as security severity',
    (baseMessage) => {
      const config = createTestConfig()
      const backendRegistry = createMockBackendRegistry()
      const errorHandler = new ErrorHandler(backendRegistry, config)

      const securityKeywords = [
        'security',
        'vulnerability',
        'injection',
        'xss',
        'csrf',
      ]
      const message = `${baseMessage} security issue`
      const error: AgentError = { message, retryable: true }

      const severity = errorHandler.classifyError(error)

      if (securityKeywords.some((kw) => message.toLowerCase().includes(kw))) {
        expect(severity).toBe('security')
      }
    },
  )

  test.prop([fc.string()], { numRuns: 20 })(
    'Non-retryable errors are classified as fatal when no keyword matches',
    (baseMessage) => {
      const config = createTestConfig()
      const backendRegistry = createMockBackendRegistry()
      const errorHandler = new ErrorHandler(backendRegistry, config)

      // Strip out keywords that would trigger security/architectural/transient classification
      const keywordsToAvoid = [
        'security',
        'vulnerability',
        'injection',
        'xss',
        'csrf',
        'architectural',
        'deadlock',
        'circular dependency',
        'contradiction',
        'timeout',
        'network',
        'temporary',
        'unavailable',
      ]
      const safeMessage = keywordsToAvoid.reduce(
        (msg, kw) => msg.replaceAll(kw, 'redacted'),
        baseMessage.toLowerCase(),
      )

      const error: AgentError = { message: safeMessage, retryable: false }
      const severity = errorHandler.classifyError(error)

      expect(severity).toBe('fatal')
    },
  )
})

describe('Retry Strategy Properties', () => {
  test.prop([fc.string({ minLength: 1, maxLength: 20 })], { numRuns: 10 })(
    'Retry strategies progress from default to reduced-context to alternative-backend',
    (runId) => {
      const config = createTestConfig()
      const backendRegistry = createMockBackendRegistry()
      const errorHandler = new ErrorHandler(backendRegistry, config)

      const agent = createNonRollbackAgent()
      const phase: PhaseName = 'implementation'
      const error = createRetryableError()

      // First retry - strategy moves from 'default' to 'reduced-context'
      const result1 = errorHandler.handleFailure(runId, phase, error, agent)
      expect(result1.action).toBe('retry')
      // After first call, lastStrategy becomes 'reduced-context', so result shows reducedContext
      expect(result1.modifiedContext?.reducedContext).toBe(true)
      expect(result1.modifiedContext?.alternativeBackend).toBeUndefined()

      // Second retry - strategy moves from 'reduced-context' to 'alternative-backend'
      const result2 = errorHandler.handleFailure(runId, phase, error, agent)
      expect(result2.action).toBe('retry')
      // After second call, lastStrategy becomes 'alternative-backend', so result shows alternativeBackend
      expect(result2.modifiedContext?.alternativeBackend).toBe('backend-2')

      // Third retry - strategy stays at 'alternative-backend' (or escalate if max retries exceeded)
      const state = errorHandler.getRetryState(runId, phase)
      if (state.count < (config.maxPhaseRetries ?? 2)) {
        const result3 = errorHandler.handleFailure(runId, phase, error, agent)
        if (result3.action === 'retry') {
          // Strategy continues to be 'alternative-backend'
          expect(result3.modifiedContext?.alternativeBackend).toBeDefined()
        }
      }
    },
  )
})

describe('Failure Report Properties', () => {
  test.prop(
    [
      fc.string({ minLength: 5, maxLength: 20 }),
      fc.string({ minLength: 1, maxLength: 50 }),
    ],
    { numRuns: 10 },
  )(
    'Failure reports include all required information for escalation',
    (runId, errorMessage) => {
      const config = createTestConfig()
      const backendRegistry = createMockBackendRegistry()
      const errorHandler = new ErrorHandler(backendRegistry, config)

      const phase: PhaseName = 'test-verification'
      const error: AgentError = { message: errorMessage, retryable: false }
      const phaseOutputs = { intake: { result: 'ok' } }

      const report = errorHandler.buildFailureReport(
        runId,
        phase,
        error,
        phaseOutputs,
      )

      expect(report.runId).toBe(runId)
      expect(report.failedPhase).toBe(phase)
      expect(report.error.message).toBe(errorMessage)
      expect(report.severity).toBeDefined()
      expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(report.previousOutputs).toEqual(phaseOutputs)
    },
  )
})

describe('Phase Error Policy Properties (Task 14.4)', () => {
  const HALT_PHASES: PhaseName[] = [
    'intake',
    'validation',
    'architecture-analysis',
    'review-delivery',
  ]
  const LOOPBACK_PHASES: PhaseName[] = [
    'architecture-review',
    'test-verification',
  ]
  const RETRY_PHASES: PhaseName[] = ['implementation', 'ui-validation']

  /**
   * Property 55: Halt-policy phases return halt on retryable failure
   * Validates: Requirement 16.6
   */
  test.prop([fc.string({ minLength: 5, maxLength: 20 })], { numRuns: 10 })(
    'Property 55: Halt-policy phases return halt instead of retry',
    (runId) => {
      const config = createTestConfig()
      const backendRegistry = createMockBackendRegistry()
      const errorHandler = new ErrorHandler(backendRegistry, config)
      const agent = createNonRollbackAgent()

      for (const phase of HALT_PHASES) {
        const result = errorHandler.handleFailure(
          `${runId}-${phase}`,
          phase,
          createRetryableError(),
          agent,
        )
        expect(result.action).toBe('halt')
        expect(result.reason).toContain('policy requires halt')
      }
    },
  )

  /**
   * Property 56: Loopback-policy phases return loopback on retryable failure
   * Validates: Requirement 16.6
   */
  test.prop([fc.string({ minLength: 5, maxLength: 20 })], { numRuns: 10 })(
    'Property 56: Loopback-policy phases return loopback on failure',
    (runId) => {
      const config = createTestConfig()
      const backendRegistry = createMockBackendRegistry()
      const errorHandler = new ErrorHandler(backendRegistry, config)
      const agent = createNonRollbackAgent()

      for (const phase of LOOPBACK_PHASES) {
        const result = errorHandler.handleFailure(
          `${runId}-${phase}`,
          phase,
          createRetryableError(),
          agent,
        )
        expect(result.action).toBe('loopback')
        expect(result.reason).toContain('loopback')
      }
    },
  )

  /**
   * Property 57: Retry-policy phases still retry normally
   * Validates: Requirement 16.2
   */
  test.prop([fc.string({ minLength: 5, maxLength: 20 })], { numRuns: 10 })(
    'Property 57: Retry-policy phases return retry on failure',
    (runId) => {
      const config = createTestConfig()
      const backendRegistry = createMockBackendRegistry()
      const errorHandler = new ErrorHandler(backendRegistry, config)
      const agent = createNonRollbackAgent()

      for (const phase of RETRY_PHASES) {
        const result = errorHandler.handleFailure(
          `${runId}-${phase}`,
          phase,
          createRetryableError(),
          agent,
        )
        expect(result.action).toBe('retry')
      }
    },
  )

  /**
   * Property 58: Security errors override phase policy — always escalate
   * Validates: Requirement 16.4
   */
  test.prop([fc.string({ minLength: 5, maxLength: 20 })], { numRuns: 10 })(
    'Property 58: Security errors escalate regardless of phase policy',
    (runId) => {
      const config = createTestConfig()
      const backendRegistry = createMockBackendRegistry()
      const errorHandler = new ErrorHandler(backendRegistry, config)
      const agent = createNonRollbackAgent()

      const allPhases: PhaseName[] = [
        ...HALT_PHASES,
        ...LOOPBACK_PHASES,
        ...RETRY_PHASES,
      ]
      for (const phase of allPhases) {
        const result = errorHandler.handleFailure(
          `${runId}-${phase}`,
          phase,
          createSecurityError(),
          agent,
        )
        expect(result.action).toBe('escalate')
      }
    },
  )

  /**
   * Property 59: Phase-specific maxRetries respected over global config
   * Validates: Requirement 16.6
   */
  test.prop([fc.string({ minLength: 5, maxLength: 20 })], { numRuns: 10 })(
    'Property 59: Loopback phases use their own maxRetries (not global)',
    (runId) => {
      const config = createTestConfig({ maxPhaseRetries: 5 })
      const backendRegistry = createMockBackendRegistry()
      const errorHandler = new ErrorHandler(backendRegistry, config)
      const agent = createNonRollbackAgent()

      // architecture-review has maxRetries: 1, so after 1 failure it should escalate
      const phase: PhaseName = 'architecture-review'
      const result1 = errorHandler.handleFailure(
        runId,
        phase,
        createRetryableError(),
        agent,
      )
      expect(result1.action).toBe('loopback')

      // Second failure should escalate (maxRetries: 1 exceeded)
      const result2 = errorHandler.handleFailure(
        runId,
        phase,
        createRetryableError(),
        agent,
      )
      expect(result2.action).toBe('escalate')
    },
  )
})

describe('Retry Context Application Properties (Task 14.4)', () => {
  /**
   * Property 60: Reduced context strategy produces reducedContext flag
   * Validates: Requirement 16.2
   */
  test.prop([fc.string({ minLength: 5, maxLength: 20 })], { numRuns: 10 })(
    'Property 60: First retry produces reducedContext in modifiedContext',
    (runId) => {
      const config = createTestConfig()
      const backendRegistry = createMockBackendRegistry()
      const errorHandler = new ErrorHandler(backendRegistry, config)
      const agent = createNonRollbackAgent()
      const phase: PhaseName = 'implementation'

      const result = errorHandler.handleFailure(
        runId,
        phase,
        createRetryableError(),
        agent,
      )
      expect(result.action).toBe('retry')
      expect(result.modifiedContext?.reducedContext).toBe(true)
      expect(result.modifiedContext?.alternativeBackend).toBeUndefined()
    },
  )

  /**
   * Property 61: Second retry produces alternativeBackend in modifiedContext
   * Validates: Requirement 16.2
   */
  test.prop([fc.string({ minLength: 5, maxLength: 20 })], { numRuns: 10 })(
    'Property 61: Second retry produces alternativeBackend in modifiedContext',
    (runId) => {
      const config = createTestConfig()
      const backendRegistry = createMockBackendRegistry()
      const errorHandler = new ErrorHandler(backendRegistry, config)
      const agent = createNonRollbackAgent()
      const phase: PhaseName = 'implementation'

      // First retry
      errorHandler.handleFailure(runId, phase, createRetryableError(), agent)

      // Second retry should suggest alternative backend
      const result = errorHandler.handleFailure(
        runId,
        phase,
        createRetryableError(),
        agent,
      )
      expect(result.action).toBe('retry')
      expect(result.modifiedContext?.alternativeBackend).toBe('backend-2')
    },
  )
})
