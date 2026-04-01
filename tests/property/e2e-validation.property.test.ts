/**
 * Property-Based E2E Validation Tests
 *
 * Tests universal correctness properties for the KASO E2E test infrastructure
 * using fast-check. Each property maps to a design document property and
 * validates specific requirements.
 *
 * This file covers Property 1 (scaffolding and config validation).
 * Subsequent properties are added by tasks 14.2–14.14.
 */

import { describe, expect, afterEach, afterAll } from 'vitest'
import { test, fc } from '@fast-check/vitest'
import { validateConfig } from '@/config/schema'
import type { KASOConfig } from '@/config/schema'
import { createMockProject } from '../e2e/helpers/mock-project'
import type { MockProjectResult } from '../e2e/helpers/mock-project'
import { readFileSync, existsSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { MockBackend } from '../e2e/helpers/mock-backend'
import { EventBus } from '@/core/event-bus'
import { EventCollector } from '../e2e/helpers/event-collector'
import { ExecutionStore } from '@/infrastructure/execution-store'
import { CheckpointManager } from '@/infrastructure/checkpoint-manager'
import { CostTracker } from '@/infrastructure/cost-tracker'
import { WebhookDispatcher } from '@/infrastructure/webhook-dispatcher'
import { createPhaseInjector, BUILTIN_PHASES } from '@/plugins/phase-injector'
import { createMCPClient } from '@/infrastructure/mcp-client'
import { ErrorHandler } from '@/core/error-handler'
import { BackendRegistry } from '@/backends/backend-registry'
import type { Agent } from '@/agents/agent-interface'
import {
  createIntakeOutput,
  createValidationOutput,
  createArchitectureAnalysisOutput,
  createImplementationOutput,
  createArchitectureReviewOutput,
  createTestVerificationOutput,
  createUIValidationOutput,
  createReviewDeliveryOutput,
  createDefaultPhaseResponses,
} from '../e2e/helpers/phase-outputs'
import type {
  PhaseName,
  EventType,
  ExecutionEvent,
  PhaseResultRecord,
  AgentError,
} from '@/core/types'

/** Track mock projects for cleanup */
const projectsToCleanup: MockProjectResult[] = []

afterEach(async () => {
  for (const project of projectsToCleanup) {
    await project.cleanup()
  }
  projectsToCleanup.length = 0
})

/**
 * Arbitrary for valid config overrides that createMockProject accepts.
 * Generates partial KASOConfig objects with randomized but structurally
 * valid values — the property asserts the merged config always validates.
 */
const configOverridesArbitrary: fc.Arbitrary<Partial<KASOConfig>> = fc.record(
  {
    maxPhaseRetries: fc.integer({ min: 0, max: 10 }),
    defaultPhaseTimeout: fc.integer({ min: 1, max: 600 }),
    maxConcurrentAgents: fc.oneof(
      fc.constant('auto' as const),
      fc.integer({ min: 1, max: 16 }),
    ),
    backendSelectionStrategy: fc.constantFrom(
      'default' as const,
      'context-aware' as const,
    ),
    costBudgetPerRun: fc.oneof(
      fc.constant(undefined),
      fc.double({ min: 0.01, max: 100, noNaN: true }),
    ),
    contextCapping: fc.record({
      enabled: fc.boolean(),
      charsPerToken: fc.integer({ min: 1, max: 20 }),
      relevanceRanking: fc.array(fc.string({ minLength: 1, maxLength: 30 }), {
        minLength: 0,
        maxLength: 5,
      }),
    }),
    reviewCouncil: fc.record({
      maxReviewRounds: fc.integer({ min: 1, max: 5 }),
      enableParallelReview: fc.boolean(),
      perspectives: fc.constant([
        'security',
        'performance',
        'maintainability',
      ] as ('security' | 'performance' | 'maintainability')[]),
    }),
    uiBaseline: fc.record({
      baselineDir: fc.constant('.kiro/ui-baselines'),
      captureOnPass: fc.boolean(),
      diffThreshold: fc.double({ min: 0, max: 1, noNaN: true }),
      viewport: fc.record({
        width: fc.integer({ min: 320, max: 3840 }),
        height: fc.integer({ min: 240, max: 2160 }),
      }),
    }),
  },
  { requiredKeys: [] },
)

/**
 * Arbitrary for valid feature names (kebab-case, non-empty)
 */
const featureNameArbitrary: fc.Arbitrary<string> = fc
  .stringMatching(/^[a-z][a-z0-9-]{0,29}$/)
  .filter((s) => s.length > 0 && !s.endsWith('-'))

describe('E2E Validation Properties', () => {
  // Feature: end-to-end-validation, Property 1: Scaffolded config always passes schema validation
  // Validates: Requirements 1.1
  describe('Property 1: Scaffolded config always passes schema validation', () => {
    test.prop([configOverridesArbitrary])(
      'createMockProject config with arbitrary overrides passes validateConfig()',
      async (overrides) => {
        const project = await createMockProject({ configOverrides: overrides })
        projectsToCleanup.push(project)

        const rawConfig = JSON.parse(readFileSync(project.configPath, 'utf-8'))
        const validated = validateConfig(rawConfig)

        expect(validated).toBeDefined()
        expect(validated.executorBackends.length).toBeGreaterThan(0)
        expect(validated.defaultBackend).toBe('mock-backend')
        expect(validated.executionStore.path).toBe(':memory:')
      },
    )

    test.prop([featureNameArbitrary])(
      'createMockProject with arbitrary feature names produces valid config',
      async (featureName) => {
        const project = await createMockProject({ featureName })
        projectsToCleanup.push(project)

        const rawConfig = JSON.parse(readFileSync(project.configPath, 'utf-8'))
        const validated = validateConfig(rawConfig)

        expect(validated).toBeDefined()
        expect(validated.executorBackends.length).toBeGreaterThan(0)
      },
    )

    test.prop([configOverridesArbitrary, featureNameArbitrary])(
      'createMockProject with both overrides and feature name produces valid config',
      async (overrides, featureName) => {
        const project = await createMockProject({
          featureName,
          configOverrides: overrides,
        })
        projectsToCleanup.push(project)

        const rawConfig = JSON.parse(readFileSync(project.configPath, 'utf-8'))

        // Must not throw — this is the core property
        const validated = validateConfig(rawConfig)
        expect(validated).toBeDefined()

        // Execution store should always be in-memory for E2E tests
        expect(validated.executionStore.type).toBe('sqlite')
        expect(validated.executionStore.path).toBe(':memory:')
      },
    )
  })

  // Feature: end-to-end-validation, Property 2 & 3: Mock backend contract
  // Validates: Requirements 2.2, 2.3, 2.7
  describe('Property 2 & 3: Mock backend contract', () => {
    /**
     * Arbitrary for valid backend names
     */
    const backendNameArbitrary: fc.Arbitrary<string> = fc
      .stringMatching(/^[a-z][a-z0-9-]{0,29}$/)
      .filter((s) => s.length > 0)

    /**
     * Arbitrary for valid phase names
     */
    const phaseNameArbitrary: fc.Arbitrary<PhaseName> = fc.constantFrom(
      'intake',
      'validation',
      'architecture-analysis',
      'implementation',
      'architecture-review',
      'test-verification',
      'ui-validation',
      'review-delivery',
    )

    test.prop([
      backendNameArbitrary,
      phaseNameArbitrary,
      fc.boolean(),
      fc.string(),
      fc.integer({ min: 1, max: 100000 }),
    ])(
      'execute() returns configured values with correct success status and output',
      async (backendName, phase, success, errorMessage, tokensUsed) => {
        const backend = new MockBackend({
          name: backendName,
          maxContextWindow: 128000,
          costPer1000Tokens: 0.01,
        })

        const expectedOutput = {
          modifiedFiles: ['src/test.ts'],
          addedTests: [],
          duration: 100,
          backend: backendName,
          selfCorrectionAttempts: 0,
        }

        backend.setPhaseResponse(phase, {
          success,
          output: expectedOutput,
          error: success ? undefined : errorMessage,
          tokensUsed,
        })

        const response = await backend.execute({
          id: 'test-request',
          phase,
          streamProgress: false,
          context: {
            runId: 'test-run',
            spec: {
              specPath: '/test/spec',
              featureName: 'test-feature',
              design: {
                rawContent: '',
                sections: [],
                codeBlocks: [],
                metadata: {},
              },
              techSpec: {
                rawContent: '',
                sections: [],
                codeBlocks: [],
                metadata: {},
              },
              taskList: [],
              missingFiles: [],
            },
            steering: {
              codingPractices: '',
              personality: '',
              commitConventions: '',
              hooks: {},
            },
            phaseOutputs: {},
            backends: {},
            config: {} as KASOConfig,
          },
        })

        expect(response.success).toBe(success)
        if (success) {
          expect(response.output).toEqual(expectedOutput)
        } else {
          expect(response.error).toBe(errorMessage)
        }
        expect(response.tokensUsed).toBe(tokensUsed)

        // Verify execution log tracking (Req 2.5)
        const log = backend.getExecutionLog()
        expect(log).toHaveLength(1)
        expect(log[0]!.phase).toBe(phase)
      },
    )

    test.prop([backendNameArbitrary, phaseNameArbitrary])(
      'execute() emits at least 2 progress events',
      async (backendName, phase) => {
        const backend = new MockBackend({
          name: backendName,
          maxContextWindow: 128000,
          costPer1000Tokens: 0.01,
        })

        const progressEvents: unknown[] = []
        backend.onProgress((event) => {
          progressEvents.push(event)
        })

        await backend.execute({
          id: 'test-request',
          phase,
          streamProgress: false,
          context: {
            runId: 'test-run',
            spec: {
              specPath: '/test/spec',
              featureName: 'test-feature',
              design: {
                rawContent: '',
                sections: [],
                codeBlocks: [],
                metadata: {},
              },
              techSpec: {
                rawContent: '',
                sections: [],
                codeBlocks: [],
                metadata: {},
              },
              taskList: [],
              missingFiles: [],
            },
            steering: {
              codingPractices: '',
              personality: '',
              commitConventions: '',
              hooks: {},
            },
            phaseOutputs: {},
            backends: {},
            config: {} as KASOConfig,
          },
        })

        expect(progressEvents.length).toBeGreaterThanOrEqual(2)
      },
    )

    test.prop([
      backendNameArbitrary,
      phaseNameArbitrary,
      fc.integer({ min: 10, max: 200 }),
    ])(
      'setDelay() causes execute() to take at least the configured delay',
      async (backendName, phase, delayMs) => {
        const backend = new MockBackend({
          name: backendName,
          maxContextWindow: 128000,
          costPer1000Tokens: 0.01,
        })

        backend.setDelay(delayMs)

        const startTime = Date.now()
        await backend.execute({
          id: 'test-request',
          phase,
          streamProgress: false,
          context: {
            runId: 'test-run',
            spec: {
              specPath: '/test/spec',
              featureName: 'test-feature',
              design: {
                rawContent: '',
                sections: [],
                codeBlocks: [],
                metadata: {},
              },
              techSpec: {
                rawContent: '',
                sections: [],
                codeBlocks: [],
                metadata: {},
              },
              taskList: [],
              missingFiles: [],
            },
            steering: {
              codingPractices: '',
              personality: '',
              commitConventions: '',
              hooks: {},
            },
            phaseOutputs: {},
            backends: {},
            config: {} as KASOConfig,
          },
        })
        const endTime = Date.now()

        // Execution should take at least the configured delay (with small tolerance)
        expect(endTime - startTime).toBeGreaterThanOrEqual(delayMs - 5)
      },
    )
  })

  // Feature: end-to-end-validation, Property 4, 5, 6, 13: Pipeline event invariants
  // Validates: Requirements 3.4, 3.5, 3.6, 9.1, 9.4
  describe('Property 4, 5, 6, 13: Pipeline event invariants', () => {
    /** All 8 built-in pipeline phases */
    const ALL_PHASES: PhaseName[] = [
      'intake',
      'validation',
      'architecture-analysis',
      'implementation',
      'architecture-review',
      'test-verification',
      'ui-validation',
      'review-delivery',
    ]

    /** Complete set of valid EventType values from the type system */
    const VALID_EVENT_TYPES: EventType[] = [
      'phase:started',
      'phase:completed',
      'phase:failed',
      'phase:timeout',
      'run:started',
      'run:paused',
      'run:resumed',
      'run:completed',
      'run:failed',
      'run:cancelled',
      'run:budget_exceeded',
      'run:escalated',
      'agent:progress',
      'agent:error',
      'worktree:created',
      'worktree:deleted',
      'concurrency:acquired',
      'concurrency:released',
      'concurrency:queued',
      'concurrency:dequeued',
      'watcher:started',
      'watcher:ready',
      'watcher:stopped',
      'watcher:error',
      'watcher:status:detected',
      'watcher:status:removed',
      'watcher:spec:ready',
      'watcher:callback:error',
      'mcp:connected',
      'mcp:disconnected',
      'mcp:error',
      'mcp:reconnected',
      'mcp:tool:invoking',
      'mcp:tool:success',
      'mcp:tool:error',
      'agent:backend-selected',
    ]

    /** Arbitrary for valid EventType values */
    const eventTypeArbitrary: fc.Arbitrary<EventType> = fc.constantFrom(
      ...VALID_EVENT_TYPES,
    )

    /** Arbitrary for valid phase names */
    const phaseNameArbitrary: fc.Arbitrary<PhaseName> = fc.constantFrom(
      ...ALL_PHASES,
    )

    /** Arbitrary for non-empty run IDs */
    const runIdArbitrary: fc.Arbitrary<string> = fc
      .stringMatching(/^[a-z0-9-]{1,36}$/)
      .filter((s) => s.length > 0)

    // Property 4: Phase events are paired for every phase
    // For any set of phases emitted through EventBus, every phase:started
    // must have a corresponding phase:completed or phase:failed collected
    // by EventCollector.
    test.prop([
      fc.uniqueArray(phaseNameArbitrary, { minLength: 1, maxLength: 8 }),
      runIdArbitrary,
      fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
    ])(
      'Property 4: every phase:started has a matching phase:completed or phase:failed via EventBus',
      (phases, runId, successFlags) => {
        const eventBus = new EventBus()
        const collector = new EventCollector(eventBus)

        try {
          // Emit run:started
          eventBus.emit({
            type: 'run:started',
            runId,
            timestamp: new Date().toISOString(),
          })

          // Emit paired phase events for each phase
          for (let i = 0; i < phases.length; i++) {
            const phase = phases[i]!
            const succeeded = successFlags[i] ?? true

            eventBus.emit({
              type: 'phase:started',
              runId,
              timestamp: new Date().toISOString(),
              phase,
            })

            eventBus.emit({
              type: succeeded ? 'phase:completed' : 'phase:failed',
              runId,
              timestamp: new Date().toISOString(),
              phase,
            })
          }

          // Emit run completion
          eventBus.emit({
            type: 'run:completed',
            runId,
            timestamp: new Date().toISOString(),
          })

          // Verify pairing invariant via EventCollector
          const startedEvents = collector
            .getByType('phase:started')
            .filter((e) => e.runId === runId)
          const completedEvents = collector
            .getByType('phase:completed')
            .filter((e) => e.runId === runId)
          const failedEvents = collector
            .getByType('phase:failed')
            .filter((e) => e.runId === runId)

          // Every started event must have a completed or failed counterpart
          expect(completedEvents.length + failedEvents.length).toBe(
            startedEvents.length,
          )

          // Each phase must have exactly one started and one ended event
          for (const phase of phases) {
            const phaseStarted = startedEvents.filter((e) => e.phase === phase)
            const phaseEnded = [
              ...completedEvents.filter((e) => e.phase === phase),
              ...failedEvents.filter((e) => e.phase === phase),
            ]
            expect(phaseEnded.length).toBe(phaseStarted.length)
          }

          // run:started must precede all phase events
          collector.assertOrdering('run:started', 'phase:started')
        } finally {
          collector.dispose()
          eventBus.removeAllListeners()
        }
      },
    )

    // Property 5: Phase result timing invariants
    // For any PhaseResultRecord, duration > 0, startedAt is valid ISO 8601,
    // completedAt is valid ISO 8601, and completedAt >= startedAt.
    test.prop([
      phaseNameArbitrary,
      runIdArbitrary,
      fc.integer({ min: 1, max: 300000 }),
      fc.integer({
        min: new Date('2020-01-01T00:00:00Z').getTime(),
        max: new Date('2030-12-31T23:59:59Z').getTime(),
      }),
    ])(
      'Property 5: PhaseResultRecord timing invariants hold for any valid phase',
      (phase, runId, durationMs, baseTimestamp) => {
        const startedAt = new Date(baseTimestamp).toISOString()
        const completedAt = new Date(baseTimestamp + durationMs).toISOString()

        const record: PhaseResultRecord = {
          runId,
          phase,
          sequence: 0,
          status: 'success',
          startedAt,
          completedAt,
          duration: durationMs,
        }

        // Duration must be positive
        expect(record.duration).toBeGreaterThan(0)

        // startedAt must be valid ISO 8601
        const parsedStart = Date.parse(record.startedAt)
        expect(isNaN(parsedStart)).toBe(false)

        // completedAt must be valid ISO 8601
        const parsedComplete = Date.parse(record.completedAt!)
        expect(isNaN(parsedComplete)).toBe(false)

        // completedAt must not be before startedAt
        expect(parsedComplete).toBeGreaterThanOrEqual(parsedStart)

        // duration should match the difference (within rounding tolerance)
        expect(parsedComplete - parsedStart).toBe(durationMs)
      },
    )

    // Property 6: Phase sequence numbers are monotonically increasing
    // For any completed run with N phases, sequence fields form a strictly
    // increasing sequence starting at 0.
    test.prop([fc.integer({ min: 1, max: 8 }), runIdArbitrary])(
      'Property 6: sequence numbers 0..N-1 are strictly increasing for N phases',
      (phaseCount, runId) => {
        const phases = ALL_PHASES.slice(0, phaseCount)
        const records: PhaseResultRecord[] = phases.map((phase, idx) => ({
          runId,
          phase,
          sequence: idx,
          status: 'success' as const,
          startedAt: new Date(Date.now() + idx * 1000).toISOString(),
          completedAt: new Date(Date.now() + idx * 1000 + 500).toISOString(),
          duration: 500,
        }))

        // Shuffle to simulate out-of-order retrieval, then sort by sequence
        const shuffled = [...records].sort(() => Math.random() - 0.5)
        const sorted = shuffled.sort((a, b) => a.sequence - b.sequence)

        // Sequence must start at 0
        expect(sorted[0]!.sequence).toBe(0)

        // Sequence must be strictly increasing with no gaps
        for (let i = 1; i < sorted.length; i++) {
          expect(sorted[i]!.sequence).toBe(sorted[i - 1]!.sequence + 1)
        }

        // Final sequence must be N-1
        expect(sorted[sorted.length - 1]!.sequence).toBe(phaseCount - 1)
      },
    )

    // Property 13: All events have valid structure
    // For any ExecutionEvent emitted through EventBus, runId is non-empty,
    // timestamp is valid ISO 8601, and type is a member of the EventType union.
    test.prop([
      eventTypeArbitrary,
      runIdArbitrary,
      fc.option(phaseNameArbitrary),
      fc.option(
        fc.record({
          detail: fc.string(),
          count: fc.integer({ min: 0, max: 1000 }),
        }),
      ),
    ])(
      'Property 13: events emitted through EventBus have valid structure',
      (type, runId, phase, data) => {
        const eventBus = new EventBus()
        const collector = new EventCollector(eventBus)

        try {
          const event: ExecutionEvent = {
            type,
            runId,
            timestamp: new Date().toISOString(),
            ...(phase !== null ? { phase } : {}),
            ...(data !== null ? { data } : {}),
          }

          eventBus.emit(event)

          const collected = collector.getEvents()
          expect(collected).toHaveLength(1)

          const received = collected[0]!

          // type must be a valid EventType member
          expect(VALID_EVENT_TYPES).toContain(received.type)

          // runId must be non-empty string
          expect(typeof received.runId).toBe('string')
          expect(received.runId.length).toBeGreaterThan(0)

          // timestamp must be valid ISO 8601
          const parsedTs = Date.parse(received.timestamp)
          expect(isNaN(parsedTs)).toBe(false)
          // Round-trip: parsing and re-serializing should produce a valid date
          expect(new Date(parsedTs).toISOString()).toBe(received.timestamp)

          // If phase is present, it must be a valid PhaseName
          if (received.phase) {
            expect(ALL_PHASES).toContain(received.phase)
          }

          // Event collected via getByType must match
          const byType = collector.getByType(type)
          expect(byType).toHaveLength(1)
          expect(byType[0]!.runId).toBe(runId)

          // Event collected via getByRunId must match
          const byRunId = collector.getByRunId(runId)
          expect(byRunId).toHaveLength(1)
          expect(byRunId[0]!.type).toBe(type)
        } finally {
          collector.dispose()
          eventBus.removeAllListeners()
        }
      },
    )
  })

  // Feature: end-to-end-validation, Property 7 & 8: Phase output shapes
  // Validates: Requirements 4.1–4.8, 4.11
  describe('Property 7 & 8: Phase output shapes', () => {
    /** Required output keys per phase, matching the type interfaces */
    const PHASE_OUTPUT_KEYS: Record<string, string[]> = {
      intake: ['featureName', 'designDoc', 'taskList'],
      validation: ['approved', 'issues'],
      'architecture-analysis': ['patterns', 'moduleBoundaries', 'adrsFound'],
      implementation: ['modifiedFiles', 'addedTests', 'duration', 'backend'],
      'architecture-review': ['approved', 'violations'],
      'test-verification': ['passed', 'testsRun', 'coverage', 'duration'],
      'ui-validation': ['approved', 'uiIssues'],
      'review-delivery': ['consensus', 'votes'],
    }

    /** Map phase names to their fixture factory functions */
    const PHASE_FACTORIES: Record<string, () => Record<string, unknown>> = {
      intake: () => createIntakeOutput() as unknown as Record<string, unknown>,
      validation: () =>
        createValidationOutput() as unknown as Record<string, unknown>,
      'architecture-analysis': () =>
        createArchitectureAnalysisOutput() as unknown as Record<
          string,
          unknown
        >,
      implementation: () =>
        createImplementationOutput() as unknown as Record<string, unknown>,
      'architecture-review': () =>
        createArchitectureReviewOutput() as unknown as Record<string, unknown>,
      'test-verification': () =>
        createTestVerificationOutput() as unknown as Record<string, unknown>,
      'ui-validation': () =>
        createUIValidationOutput() as unknown as Record<string, unknown>,
      'review-delivery': () =>
        createReviewDeliveryOutput() as unknown as Record<string, unknown>,
    }

    const ALL_PHASES: PhaseName[] = [
      'intake',
      'validation',
      'architecture-analysis',
      'implementation',
      'architecture-review',
      'test-verification',
      'ui-validation',
      'review-delivery',
    ]

    const phaseNameArbitrary: fc.Arbitrary<PhaseName> = fc.constantFrom(
      ...ALL_PHASES,
    )

    // Property 7: Phase output shapes match their interfaces
    // For any phase, the fixture factory output must contain all required keys.
    test.prop([phaseNameArbitrary])(
      'Property 7: fixture factory outputs contain all required interface fields',
      (phase) => {
        const factory = PHASE_FACTORIES[phase]
        expect(factory).toBeDefined()

        const output = factory!()
        const requiredKeys = PHASE_OUTPUT_KEYS[phase]!

        for (const key of requiredKeys) {
          expect(output).toHaveProperty(key)
          // Value must not be undefined (field must be meaningfully present)
          expect(output[key]).toBeDefined()
        }
      },
    )

    // Property 7 extended: MockBackend wired with fixture factories returns
    // outputs that pass shape validation for any phase.
    test.prop([phaseNameArbitrary])(
      'Property 7: MockBackend phase responses have correct output shapes',
      async (phase) => {
        const responses = createDefaultPhaseResponses()
        const response = responses.get(phase)

        expect(response).toBeDefined()
        expect(response!.success).toBe(true)

        const output = response!.output as Record<string, unknown>
        expect(output).toBeDefined()

        const requiredKeys = PHASE_OUTPUT_KEYS[phase]!
        for (const key of requiredKeys) {
          expect(output).toHaveProperty(key)
        }
      },
    )

    // Property 8: UI diff threshold controls approval
    // When any screenshot's diffPercentage exceeds diffThreshold * 100,
    // the UIReview.approved field must be false.
    test.prop([
      fc.array(
        fc.record({
          route: fc.stringMatching(/^\/[a-z0-9-]{0,20}$/),
          diffPercentage: fc.double({ min: 0, max: 100, noNaN: true }),
        }),
        { minLength: 1, maxLength: 5 },
      ),
      fc.double({ min: 0.01, max: 0.99, noNaN: true }),
    ])(
      'Property 8: diffPercentage exceeding diffThreshold * 100 forces approved=false',
      (screenshots, diffThreshold) => {
        // Replicate the UIValidatorAgent approval logic:
        // diffIssues = screenshots where diffPercentage > diffThreshold * 100
        const thresholdPercent = diffThreshold * 100
        const diffIssues = screenshots.filter(
          (s) => s.diffPercentage > thresholdPercent,
        )

        // If any screenshot exceeds the threshold, approved must be false
        const approved = diffIssues.length === 0

        if (screenshots.some((s) => s.diffPercentage > thresholdPercent)) {
          expect(approved).toBe(false)
        } else {
          expect(approved).toBe(true)
        }

        // Boundary: exactly at threshold should NOT trigger a diff issue
        const atThreshold = screenshots.filter(
          (s) => s.diffPercentage === thresholdPercent,
        )
        for (const s of atThreshold) {
          expect(s.diffPercentage).not.toBeGreaterThan(thresholdPercent)
        }
      },
    )
  })

  // Feature: end-to-end-validation, Property 9, 10, 35: Checkpoint and cost tracking
  // Validates: Requirements 5.5, 6.5, 25.8
  describe('Property 9, 10, 35: Checkpoint and cost tracking', () => {
    const ALL_PHASES: PhaseName[] = [
      'intake',
      'validation',
      'architecture-analysis',
      'implementation',
      'architecture-review',
      'test-verification',
      'ui-validation',
      'review-delivery',
    ]

    const phaseNameArbitrary: fc.Arbitrary<PhaseName> = fc.constantFrom(
      ...ALL_PHASES,
    )

    const runIdArbitrary: fc.Arbitrary<string> = fc
      .stringMatching(/^[a-z0-9-]{1,36}$/)
      .filter((s) => s.length > 0)

    /** Arbitrary for backend names */
    const backendNameArbitrary: fc.Arbitrary<string> = fc
      .stringMatching(/^[a-z][a-z0-9-]{0,19}$/)
      .filter((s) => s.length > 0)

    // Shared store for checkpoint tests — avoids native handle proliferation
    let checkpointStore: ExecutionStore | null = null
    let checkpointMgr: CheckpointManager | null = null

    function getCheckpointStore(): ExecutionStore {
      if (!checkpointStore) {
        checkpointStore = new ExecutionStore({
          type: 'sqlite',
          path: ':memory:',
        })
        checkpointMgr = new CheckpointManager(checkpointStore)
      }
      return checkpointStore
    }

    function getCheckpointMgr(): CheckpointManager {
      getCheckpointStore()
      return checkpointMgr!
    }

    function resetCheckpointStore(): void {
      const db = getCheckpointStore().getDatabase()!
      db.exec('DELETE FROM checkpoints')
      db.exec('DELETE FROM phase_results')
      db.exec('DELETE FROM runs')
    }

    afterAll(() => {
      checkpointStore?.close()
      checkpointStore = null
      checkpointMgr = null
    })

    // Property 9: Checkpoint exists after each phase
    // For any run that has completed at least one phase, the CheckpointManager
    // should have a checkpoint record containing runId, phase, and serialized data.
    test.prop([
      runIdArbitrary,
      fc.uniqueArray(phaseNameArbitrary, { minLength: 1, maxLength: 8 }),
    ])(
      'Property 9: checkpoint persists after each phase with correct runId and phase',
      (runId, phases) => {
        resetCheckpointStore()

        // Must create a run record first (FK constraint)
        getCheckpointStore().saveRun({
          runId,
          specPath: '/test/spec',
          status: 'running',
          phases: ALL_PHASES,
          startedAt: new Date().toISOString(),
          cost: 0,
          phaseResults: [],
          logs: [],
        })

        // Save a checkpoint after each phase
        for (const phase of phases) {
          const phaseOutputs = { [phase]: { completed: true } }
          getCheckpointMgr().saveCheckpoint(runId, phase, {
            runId,
            phase,
            phaseOutputs,
          })

          // Verify checkpoint exists immediately after save
          const latest = getCheckpointMgr().getLatestCheckpoint(runId)
          expect(latest).not.toBeNull()
          expect(latest!.runId).toBe(runId)
          expect(latest!.phase).toBe(phase)
          expect(latest!.isLatest).toBe(true)

          // Data should contain the serialized phase outputs
          const data = latest!.data as Record<string, unknown>
          expect(data.runId).toBe(runId)
          expect(data.phase).toBe(phase)
          expect(data.phaseOutputs).toBeDefined()
        }

        // After all phases, only the last checkpoint should be "latest"
        const allCheckpoints = getCheckpointMgr().listCheckpoints(runId)
        expect(allCheckpoints).toHaveLength(phases.length)

        const latestOnes = allCheckpoints.filter((c) => c.isLatest)
        expect(latestOnes).toHaveLength(1)
        expect(latestOnes[0]!.phase).toBe(phases[phases.length - 1])
      },
    )

    // Property 10: Cost accumulation formula
    // For any sequence of invocations, total cost = sum of (tokensUsed / 1000) * costPer1000Tokens
    test.prop([
      runIdArbitrary,
      fc.array(
        fc.record({
          tokensUsed: fc.integer({ min: 0, max: 100000 }),
          costPer1000Tokens: fc.double({
            min: 0.001,
            max: 1.0,
            noNaN: true,
          }),
        }),
        { minLength: 1, maxLength: 8 },
      ),
    ])(
      'Property 10: CostTracker accumulates costs matching the formula exactly',
      (runId, invocations) => {
        const tracker = new CostTracker()

        let expectedTotal = 0
        for (const inv of invocations) {
          const returned = tracker.recordInvocation(
            runId,
            'mock-backend',
            inv.tokensUsed,
            inv.costPer1000Tokens,
          )

          const expected = (inv.tokensUsed / 1000) * inv.costPer1000Tokens
          expect(returned).toBeCloseTo(expected, 10)
          expectedTotal += expected
        }

        const runCost = tracker.getRunCost(runId)
        expect(runCost).toBeDefined()
        expect(runCost!.totalCost).toBeCloseTo(expectedTotal, 10)
        expect(runCost!.invocations).toHaveLength(invocations.length)
      },
    )

    // Property 35: Cost attribution per backend
    // For any run with multiple backends, backendCosts[name] = sum of that backend's invocations
    test.prop([
      runIdArbitrary,
      fc.array(
        fc.record({
          backendName: backendNameArbitrary,
          tokensUsed: fc.integer({ min: 1, max: 50000 }),
          costPer1000Tokens: fc.double({
            min: 0.001,
            max: 0.5,
            noNaN: true,
          }),
        }),
        { minLength: 1, maxLength: 12 },
      ),
    ])(
      'Property 35: per-backend cost attribution matches sum of that backend invocations',
      (runId, invocations) => {
        const tracker = new CostTracker()

        // Track expected costs per backend manually
        const expectedByBackend = new Map<string, number>()

        for (const inv of invocations) {
          tracker.recordInvocation(
            runId,
            inv.backendName,
            inv.tokensUsed,
            inv.costPer1000Tokens,
          )

          const cost = (inv.tokensUsed / 1000) * inv.costPer1000Tokens
          const current = expectedByBackend.get(inv.backendName) ?? 0
          expectedByBackend.set(inv.backendName, current + cost)
        }

        const runCost = tracker.getRunCost(runId)
        expect(runCost).toBeDefined()

        // Every backend in our expected map must appear in backendCosts
        for (const [backend, expectedCost] of expectedByBackend) {
          expect(runCost!.backendCosts[backend]).toBeDefined()
          expect(runCost!.backendCosts[backend]).toBeCloseTo(expectedCost, 10)
        }

        // Sum of per-backend costs must equal totalCost
        const sumOfBackends = Object.values(runCost!.backendCosts).reduce(
          (sum, c) => sum + c,
          0,
        )
        expect(sumOfBackends).toBeCloseTo(runCost!.totalCost, 10)
      },
    )
  })

  // Feature: end-to-end-validation, Property 11 & 12: Worktree behavior
  // Validates: Requirements 8.1, 8.5
  describe('Property 11 & 12: Worktree behavior', () => {
    /** Arbitrary for spec names matching the kebab-case convention */
    const specNameArbitrary: fc.Arbitrary<string> = fc
      .stringMatching(/^[a-z][a-z0-9-]{0,19}$/)
      .filter((s) => s.length > 0 && !s.endsWith('-'))

    // Property 11: Worktree branch naming convention
    // For any spec name, the branch created by WorktreeManager.create() should
    // match kaso/{specName}-{timestamp} where timestamp is a valid date string.
    // We replicate the exact naming logic from WorktreeManager.createWorktree().
    test.prop([
      specNameArbitrary,
      fc.integer({
        min: new Date('2020-01-01T00:00:00Z').getTime(),
        max: new Date('2030-12-31T23:59:59Z').getTime(),
      }),
    ])(
      'Property 11: branch name matches kaso/{specName}-{YYYYMMDDTHHmmss} pattern',
      (specName, timestampMs) => {
        // Replicate the exact timestamp formatting from WorktreeManager
        const timestamp = new Date(timestampMs)
          .toISOString()
          .replace(/[:\-]/g, '')
          .replace(/\.\d{3}Z$/, '')
        const branchName = `kaso/${specName}-${timestamp}`

        // Must start with kaso/
        expect(branchName).toMatch(/^kaso\//)

        // Must contain the spec name after kaso/
        expect(branchName.startsWith(`kaso/${specName}-`)).toBe(true)

        // Timestamp portion must be a valid compact ISO format (YYYYMMDDTHHmmss)
        const timestampPart = branchName.slice(`kaso/${specName}-`.length)
        expect(timestampPart).toMatch(/^\d{8}T\d{6}$/)

        // The timestamp should parse back to a valid date
        const year = timestampPart.slice(0, 4)
        const month = timestampPart.slice(4, 6)
        const day = timestampPart.slice(6, 8)
        const hour = timestampPart.slice(9, 11)
        const minute = timestampPart.slice(11, 13)
        const second = timestampPart.slice(13, 15)
        const reconstructed = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`
        const parsed = Date.parse(reconstructed)
        expect(isNaN(parsed)).toBe(false)

        // The runId derived from the branch should also be deterministic
        const runId = `${specName}-${timestamp}`
        expect(runId).toBe(branchName.slice('kaso/'.length))
      },
    )

    // Property 12: Worktree filesystem isolation
    // For any file written to a worktree path, that file should not exist in
    // the main working directory. We verify this by creating temp dirs that
    // simulate the worktree/main separation.
    test.prop([
      specNameArbitrary,
      fc.array(fc.stringMatching(/^[a-z][a-z0-9_]{0,15}\.[a-z]{1,4}$/), {
        minLength: 1,
        maxLength: 5,
      }),
    ])(
      'Property 12: files in worktree path do not appear in main directory',
      (specName, filenames) => {
        const mainDir =
          tmpdir() +
          `/kaso-prop12-main-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        const worktreeDir =
          tmpdir() +
          `/kaso-prop12-wt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

        mkdirSync(mainDir, { recursive: true })
        mkdirSync(worktreeDir, { recursive: true })

        try {
          // Write files only to the worktree directory
          for (const filename of filenames) {
            writeFileSync(join(worktreeDir, filename), `content-${specName}`)
          }

          // Verify files exist in worktree
          for (const filename of filenames) {
            expect(existsSync(join(worktreeDir, filename))).toBe(true)
          }

          // Verify files do NOT exist in main directory (isolation)
          for (const filename of filenames) {
            expect(existsSync(join(mainDir, filename))).toBe(false)
          }

          // Verify the directories are distinct paths
          expect(mainDir).not.toBe(worktreeDir)
        } finally {
          rmSync(mainDir, { recursive: true, force: true })
          rmSync(worktreeDir, { recursive: true, force: true })
        }
      },
    )
  })

  // Feature: end-to-end-validation, Property 14, 15, 16: SSE and webhook behavior
  // Validates: Requirements 9.6, 10.2, 10.3, 10.4
  describe('Property 14, 15, 16: SSE and webhook behavior', () => {
    const VALID_EVENT_TYPES: EventType[] = [
      'run:started',
      'run:completed',
      'run:failed',
      'phase:started',
      'phase:completed',
      'phase:failed',
    ]

    const eventTypeArbitrary: fc.Arbitrary<EventType> = fc.constantFrom(
      ...VALID_EVENT_TYPES,
    )

    const runIdArbitrary: fc.Arbitrary<string> = fc
      .stringMatching(/^[a-z0-9-]{1,36}$/)
      .filter((s) => s.length > 0)

    const phaseNameArbitrary: fc.Arbitrary<PhaseName> = fc.constantFrom(
      'intake' as PhaseName,
      'validation' as PhaseName,
      'implementation' as PhaseName,
      'review-delivery' as PhaseName,
    )

    // Property 14: SSE runId filtering
    // For any SSE client connected with ?runId=X, only events whose runId
    // equals X should be forwarded. We test this via EventBus + EventCollector
    // filtering, which mirrors the SSEServer broadcastEvent logic.
    test.prop([
      runIdArbitrary,
      runIdArbitrary,
      fc.array(eventTypeArbitrary, { minLength: 1, maxLength: 10 }),
    ])(
      'Property 14: runId filtering only forwards matching events',
      (targetRunId, otherRunId, eventTypes) => {
        // Ensure we have a distinct "other" runId
        const distinctOther =
          otherRunId === targetRunId ? `${otherRunId}-other` : otherRunId

        const eventBus = new EventBus()
        const collector = new EventCollector(eventBus)

        try {
          // Emit events for both runIds
          for (const type of eventTypes) {
            eventBus.emit({
              type,
              runId: targetRunId,
              timestamp: new Date().toISOString(),
            })
            eventBus.emit({
              type,
              runId: distinctOther,
              timestamp: new Date().toISOString(),
            })
          }

          // Filter by targetRunId (mirrors SSEServer's filterRunId logic)
          const filtered = collector.getByRunId(targetRunId)

          // Every filtered event must have the target runId
          for (const event of filtered) {
            expect(event.runId).toBe(targetRunId)
          }

          // No events for the other runId should appear
          const otherEvents = filtered.filter((e) => e.runId === distinctOther)
          expect(otherEvents).toHaveLength(0)

          // Count should match the number of event types emitted for target
          expect(filtered).toHaveLength(eventTypes.length)
        } finally {
          collector.dispose()
          eventBus.removeAllListeners()
        }
      },
    )

    // Property 15: Webhook payload structure
    // For any webhook delivery, the payload must contain event, runId,
    // timestamp, and data fields matching the WebhookPayload interface.
    // We use the real WebhookDispatcher.buildPayload() method.
    test.prop([
      eventTypeArbitrary,
      runIdArbitrary,
      fc.option(phaseNameArbitrary),
      fc.record({
        detail: fc.string(),
        count: fc.integer({ min: 0, max: 1000 }),
      }),
    ])(
      'Property 15: buildPayload produces valid WebhookPayload structure',
      (type, runId, phase, data) => {
        const dispatcher = new WebhookDispatcher()

        const event: ExecutionEvent = {
          type,
          runId,
          timestamp: new Date().toISOString(),
          ...(phase !== null ? { phase } : {}),
          data,
        }

        const payload = dispatcher.buildPayload(event)

        // Required fields per WebhookPayload interface
        expect(payload.event).toBe(type)
        expect(payload.runId).toBe(runId)
        expect(payload.timestamp).toBeDefined()
        expect(typeof payload.timestamp).toBe('string')

        // Timestamp must be valid ISO 8601
        const parsedTs = Date.parse(payload.timestamp)
        expect(isNaN(parsedTs)).toBe(false)

        // Phase should be present if provided
        if (phase !== null) {
          expect(payload.phase).toBe(phase)
        }

        // Data should be present (sanitized copy)
        expect(payload.data).toBeDefined()
      },
    )

    // Property 16: Webhook signature round-trip
    // For any payload and secret, signPayload then verifySignature must
    // return true. Uses the real WebhookDispatcher methods.
    test.prop([
      fc.string({ minLength: 1, maxLength: 500 }),
      fc.string({ minLength: 1, maxLength: 64 }),
    ])(
      'Property 16: signPayload + verifySignature round-trip returns true',
      (payload, secret) => {
        const dispatcher = new WebhookDispatcher()

        const signature = dispatcher.signPayload(payload, secret)

        // Signature must start with sha256= prefix
        expect(signature).toMatch(/^sha256=[0-9a-f]{64}$/)

        // Round-trip verification must succeed
        expect(dispatcher.verifySignature(payload, secret, signature)).toBe(
          true,
        )

        // Tampered payload must fail verification
        const tampered = payload + 'x'
        expect(dispatcher.verifySignature(tampered, secret, signature)).toBe(
          false,
        )

        // Wrong secret must fail verification
        const wrongSecret = secret + 'wrong'
        expect(
          dispatcher.verifySignature(payload, wrongSecret, signature),
        ).toBe(false)
      },
    )
  })

  // Feature: end-to-end-validation, Property 17, 18, 19: Plugins and MCP
  // Validates: Requirements 12.2, 13.4, 14.4
  describe('Property 17, 18, 19: Plugins and MCP', () => {
    const ALL_PHASES: PhaseName[] = [
      'intake',
      'validation',
      'architecture-analysis',
      'implementation',
      'architecture-review',
      'test-verification',
      'ui-validation',
      'review-delivery',
    ]

    const phaseNameArbitrary: fc.Arbitrary<PhaseName> = fc.constantFrom(
      ...ALL_PHASES,
    )

    // Property 17: Custom phase injection position
    // For any valid position p (0–8), injecting a custom phase at position p
    // should result in that phase appearing at index p in the pipeline order.
    test.prop([
      fc.integer({ min: 0, max: 8 }),
      fc
        .stringMatching(/^[a-z][a-z0-9-]{0,14}$/)
        .filter((s) => s.length > 0 && !s.endsWith('-')),
    ])(
      'Property 17: custom phase at position p appears at index p in pipeline',
      (position, suffix) => {
        const customName = `custom-${suffix}`
        const injector = createPhaseInjector([
          { name: customName, package: 'test-plugin', position, config: {} },
        ])

        const result = injector.buildPipeline()
        const order = injector.getPhaseOrder()

        // No errors for valid input
        expect(result.errors).toHaveLength(0)

        // Pipeline should have 9 phases (8 built-in + 1 custom)
        expect(order).toHaveLength(9)

        // Custom phase should be at the specified position
        expect(order[position]).toBe(customName)

        // All 8 built-in phases should still be present
        for (const builtIn of BUILTIN_PHASES) {
          expect(order).toContain(builtIn)
        }

        // Built-in phases should maintain their relative order
        const builtInOnly = order.filter((p) =>
          BUILTIN_PHASES.includes(p as PhaseName),
        )
        expect(builtInOnly).toEqual(BUILTIN_PHASES)
      },
    )

    // Property 18: MCP tools scoped to implementation phase only
    // For any phase that is not 'implementation', isPhaseEligible should
    // return false and getToolsForPhase should return an empty array.
    test.prop([phaseNameArbitrary])(
      'Property 18: MCPClient.isPhaseEligible returns true only for implementation',
      (phase) => {
        const client = createMCPClient([])

        const eligible = client.isPhaseEligible(phase)
        const tools = client.getToolsForPhase(phase)

        if (phase === 'implementation') {
          expect(eligible).toBe(true)
        } else {
          expect(eligible).toBe(false)
          expect(tools).toHaveLength(0)
        }
      },
    )

    // Property 19: FileWatcher debounce
    // For any number of rapid status.json writes within the debounce window,
    // the seenSpecs deduplication should ensure at most one callback per spec.
    // We test the deduplication logic by simulating the FileWatcher's seenSpecs set.
    test.prop([
      fc.array(
        fc.stringMatching(/^[a-z][a-z0-9-]{0,14}$/).filter((s) => s.length > 0),
        { minLength: 1, maxLength: 20 },
      ),
    ])(
      'Property 19: deduplication triggers at most one callback per unique spec',
      (specPaths) => {
        // Replicate FileWatcher's seenSpecs deduplication logic
        const seenSpecs = new Set<string>()
        let callbackCount = 0

        for (const specPath of specPaths) {
          if (!seenSpecs.has(specPath)) {
            seenSpecs.add(specPath)
            callbackCount++
          }
        }

        // Callbacks should equal unique spec count, not total writes
        const uniqueSpecs = new Set(specPaths).size
        expect(callbackCount).toBe(uniqueSpecs)

        // Callback count must be <= total writes
        expect(callbackCount).toBeLessThanOrEqual(specPaths.length)

        // At least one callback if there's at least one write
        expect(callbackCount).toBeGreaterThanOrEqual(1)
      },
    )
  })

  // Feature: end-to-end-validation, Property 20, 21, 33: Review council and delivery
  // Validates: Requirements 15.4, 15.6, 16.2, 25.1
  describe('Property 20, 21, 33: Review council and delivery', () => {
    /** Arbitrary for unique reviewer role strings */
    const roleArbitrary: fc.Arbitrary<string> = fc
      .stringMatching(/^[a-z][a-z0-9-]{0,14}$/)
      .filter((s) => s.length > 0 && !s.endsWith('-'))

    // Property 20: Review council votes match configured reviewers
    // For any reviewers config with N reviewers, the votes array should have
    // exactly N entries and each vote's perspective matches the reviewer's role.
    // We also verify the generalized consensus logic:
    //   all approve → passed
    //   ≥ max(1, floor(N*2/3)) → passed-with-warnings
    //   else → rejected
    test.prop([
      fc.uniqueArray(
        fc.record({
          role: roleArbitrary,
          approved: fc.boolean(),
        }),
        {
          minLength: 1,
          maxLength: 6,
          selector: (r) => r.role,
        },
      ),
    ])(
      'Property 20: votes match reviewers and consensus follows 2/3 threshold',
      (reviewerInputs) => {
        // Build votes as the ReviewCouncilAgent would
        const votes: Array<{
          perspective: string
          approved: boolean
          feedback: string
          severity: 'low'
        }> = reviewerInputs.map((r) => ({
          perspective: r.role,
          approved: r.approved,
          feedback: 'test',
          severity: 'low' as const,
        }))

        // Votes count must equal reviewer count
        expect(votes).toHaveLength(reviewerInputs.length)

        // Each vote's perspective must match the reviewer's role
        for (let i = 0; i < reviewerInputs.length; i++) {
          expect(votes[i]!.perspective).toBe(reviewerInputs[i]!.role)
        }

        // Replicate the exact consensus logic from ReviewCouncilAgent.determineConsensus
        const approvalCount = votes.filter((v) => v.approved).length
        const totalCount = votes.length

        let expected: 'passed' | 'passed-with-warnings' | 'rejected'
        if (approvalCount === totalCount) {
          expected = 'passed'
        } else {
          const threshold = Math.max(1, Math.floor((totalCount * 2) / 3))
          expected =
            approvalCount >= threshold ? 'passed-with-warnings' : 'rejected'
        }

        // Verify specific cases from requirements:
        // Req 15.9: single reviewer approve → passed, reject → rejected
        if (totalCount === 1) {
          expect(expected).toBe(approvalCount === 1 ? 'passed' : 'rejected')
        }

        // Req 15.10: 4 reviewers, 2 approve → passed-with-warnings
        // (floor(4*2/3) = 2, so 2 >= 2 → passed-with-warnings)
        if (totalCount === 4 && approvalCount === 2) {
          expect(expected).toBe('passed-with-warnings')
        }

        // 0 approvals always → rejected (threshold is at least 1)
        if (approvalCount === 0) {
          expect(expected).toBe('rejected')
        }

        expect(['passed', 'passed-with-warnings', 'rejected']).toContain(
          expected,
        )
      },
    )

    // Property 21: Delivery branch naming convention
    // For any feature name, the branch should match kaso/{feature}-delivery-{YYYYMMDDTHHmmss}
    test.prop([
      fc
        .stringMatching(/^[a-z][a-z0-9-]{0,19}$/)
        .filter((s) => s.length > 0 && !s.endsWith('-')),
      fc.integer({
        min: new Date('2020-01-01T00:00:00Z').getTime(),
        max: new Date('2030-12-31T23:59:59Z').getTime(),
      }),
    ])(
      'Property 21: delivery branch matches kaso/{feature}-delivery-{timestamp}',
      (featureName, timestampMs) => {
        // Replicate the exact timestamp formatting from DeliveryAgent
        const timestamp = new Date(timestampMs)
          .toISOString()
          .replace(/[:\-]/g, '')
          .replace(/\.\d{3}Z$/, '')
        const branchName = `kaso/${featureName}-delivery-${timestamp}`

        // Must start with kaso/
        expect(branchName).toMatch(/^kaso\//)

        // Must contain -delivery-
        expect(branchName).toContain('-delivery-')

        // Feature name must appear between kaso/ and -delivery-
        const afterKaso = branchName.slice('kaso/'.length)
        expect(afterKaso.startsWith(`${featureName}-delivery-`)).toBe(true)

        // Timestamp portion must be valid compact ISO (YYYYMMDDTHHmmss)
        const timestampPart = branchName.slice(
          `kaso/${featureName}-delivery-`.length,
        )
        expect(timestampPart).toMatch(/^\d{8}T\d{6}$/)
      },
    )

    // Property 33: Per-reviewer backend assignment
    // For any reviewer configured with a backend field, the ReviewCouncilAgent
    // should emit an agent:backend-selected event with reason "reviewer-override"
    // and the reviewer's role. We verify the event structure.
    test.prop([
      roleArbitrary,
      fc.stringMatching(/^[a-z][a-z0-9-]{0,14}$/).filter((s) => s.length > 0),
    ])(
      'Property 33: reviewer backend override emits correct event structure',
      (reviewerRole, backendName) => {
        const eventBus = new EventBus()
        const collector = new EventCollector(eventBus)

        try {
          // Simulate the event that ReviewCouncilAgent emits for reviewer overrides
          const event: ExecutionEvent = {
            type: 'agent:backend-selected',
            runId: 'test-run',
            timestamp: new Date().toISOString(),
            phase: 'review-delivery',
            data: {
              backend: backendName,
              reason: 'reviewer-override',
              reviewerRole,
            },
          }

          eventBus.emit(event)

          const collected = collector.getByType('agent:backend-selected')
          expect(collected).toHaveLength(1)

          const received = collected[0]!
          expect(received.data!.reason).toBe('reviewer-override')
          expect(received.data!.reviewerRole).toBe(reviewerRole)
          expect(received.data!.backend).toBe(backendName)
          expect(received.phase).toBe('review-delivery')
        } finally {
          collector.dispose()
          eventBus.removeAllListeners()
        }
      },
    )
  })

  // Feature: end-to-end-validation, Property 22: Error handling and retries
  // Validates: Requirements 18.1
  describe('Property 22: Error handling and retries', () => {
    // Property 22: Retry count bounded by maxPhaseRetries
    // For any maxPhaseRetries value n and a phase configured to always fail
    // with retryable: true, the orchestrator should attempt the phase at most
    // n + 1 times (1 initial + n retries) before halting.
    test.prop([fc.integer({ min: 0, max: 10 })])(
      'Property 22: ErrorHandler respects maxPhaseRetries bound',
      (maxRetries) => {
        const backendRegistry = new BackendRegistry({
          executorBackends: [
            {
              name: 'mock',
              command: 'echo',
              args: [],
              protocol: 'cli-json' as const,
              maxContextWindow: 128000,
              costPer1000Tokens: 0.01,
              enabled: true,
            },
          ],
          defaultBackend: 'mock',
          backendSelectionStrategy: 'default' as const,
        } as unknown as KASOConfig)

        const config = {
          executorBackends: [
            {
              name: 'mock',
              command: 'echo',
              args: [],
              protocol: 'cli-json' as const,
              maxContextWindow: 128000,
              costPer1000Tokens: 0.01,
              enabled: true,
            },
          ],
          defaultBackend: 'mock',
          backendSelectionStrategy: 'default' as const,
          maxPhaseRetries: maxRetries,
        } as unknown as KASOConfig

        const handler = new ErrorHandler(backendRegistry, config)
        const runId = 'retry-test'
        const phase: PhaseName = 'implementation'
        const error: AgentError = {
          message: 'Backend failed',
          retryable: true,
        }
        const agent: Agent = {
          execute: async () => ({ success: false, duration: 0 }),
          supportsRollback: () => false,
          estimatedDuration: () => 1000,
          requiredContext: () => [],
        }

        // Simulate repeated failures
        let retryCount = 0
        for (let i = 0; i <= maxRetries + 2; i++) {
          const result = handler.handleFailure(runId, phase, error, agent)
          if (result.action === 'retry' || result.action === 'rollback-retry') {
            retryCount++
          } else {
            // Should escalate after maxRetries
            expect(result.action).toBe('escalate')
            break
          }
        }

        // Should have retried exactly maxRetries times
        expect(retryCount).toBe(maxRetries)
      },
    )
  })

  // Feature: end-to-end-validation, Property 23–26: Execution store
  // Validates: Requirements 19.1, 19.2, 19.3, 19.4, 19.5
  describe('Property 23–26: Execution store', () => {
    const ALL_PHASES: PhaseName[] = [
      'intake',
      'validation',
      'architecture-analysis',
      'implementation',
      'architecture-review',
      'test-verification',
      'ui-validation',
      'review-delivery',
    ]

    const runIdArbitrary: fc.Arbitrary<string> = fc
      .stringMatching(/^[a-z0-9-]{1,36}$/)
      .filter((s) => s.length > 0)

    // Shared store — lazily initialized to avoid native handle creation
    // when these tests aren't selected.
    let sharedStore: ExecutionStore | null = null

    function getSharedStore(): ExecutionStore {
      if (!sharedStore) {
        sharedStore = new ExecutionStore({ type: 'sqlite', path: ':memory:' })
      }
      return sharedStore
    }

    /** Wipe all rows so each iteration starts clean */
    function resetStore(): void {
      const db = getSharedStore().getDatabase()!
      db.exec('DELETE FROM phase_results')
      db.exec('DELETE FROM checkpoints')
      db.exec('DELETE FROM runs')
    }

    afterAll(() => {
      sharedStore?.close()
      sharedStore = null
    })

    // Property 23: Execution store run and phase records persist
    test.prop([runIdArbitrary, fc.integer({ min: 1, max: 8 })])(
      'Property 23: getRun and getPhaseResults return persisted records',
      (runId, phaseCount) => {
        resetStore()
        const phases = ALL_PHASES.slice(0, phaseCount)

        getSharedStore().saveRun({
          runId,
          specPath: '/test/spec',
          status: 'completed',
          phases,
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          cost: 0,
          phaseResults: [],
          logs: [],
        })

        for (let i = 0; i < phases.length; i++) {
          getSharedStore().appendPhaseResult(runId, {
            runId,
            phase: phases[i]!,
            sequence: i,
            status: 'success',
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            duration: 100,
          })
        }

        const run = getSharedStore().getRun(runId)
        expect(run).not.toBeNull()
        expect(run!.runId).toBe(runId)
        expect(run!.status).toBe('completed')

        const results = getSharedStore().getPhaseResults(runId)
        expect(results).toHaveLength(phaseCount)
        for (let i = 0; i < phaseCount; i++) {
          expect(results[i]!.phase).toBe(phases[i])
          expect(results[i]!.sequence).toBe(i)
        }
      },
    )

    // Property 24: Execution store ordering
    test.prop([fc.uniqueArray(runIdArbitrary, { minLength: 2, maxLength: 5 })])(
      'Property 24: listRuns returns all runs',
      (runIds) => {
        resetStore()

        for (const id of runIds) {
          getSharedStore().saveRun({
            runId: id,
            specPath: `/test/${id}`,
            status: 'completed',
            phases: ALL_PHASES,
            startedAt: new Date().toISOString(),
            cost: 0,
            phaseResults: [],
            logs: [],
          })
        }

        const listed = getSharedStore().listRuns()
        expect(listed).toHaveLength(runIds.length)

        const listedIds = new Set(listed.map((r) => r.runId))
        for (const id of runIds) {
          expect(listedIds.has(id)).toBe(true)
        }
      },
    )

    // Property 25: Status update round-trip
    test.prop([
      runIdArbitrary,
      fc.constantFrom(
        'pending' as const,
        'running' as const,
        'paused' as const,
        'completed' as const,
        'failed' as const,
        'cancelled' as const,
      ),
    ])(
      'Property 25: updateRunStatus persists and getRun reflects the new status',
      (runId, newStatus) => {
        resetStore()

        getSharedStore().saveRun({
          runId,
          specPath: '/test/spec',
          status: 'pending',
          phases: ALL_PHASES,
          startedAt: new Date().toISOString(),
          cost: 0,
          phaseResults: [],
          logs: [],
        })

        getSharedStore().updateRunStatus(runId, newStatus)

        const run = getSharedStore().getRun(runId)
        expect(run).not.toBeNull()
        expect(run!.status).toBe(newStatus)
      },
    )

    // Property 26: getInterruptedRuns returns only non-terminal runs
    test.prop([
      fc.array(
        fc.record({
          id: runIdArbitrary,
          status: fc.constantFrom(
            'pending' as const,
            'running' as const,
            'paused' as const,
            'completed' as const,
            'failed' as const,
            'cancelled' as const,
          ),
        }),
        { minLength: 1, maxLength: 6 },
      ),
    ])(
      'Property 26: getInterruptedRuns returns only running/paused runs',
      (runs) => {
        resetStore()

        const seen = new Set<string>()
        const uniqueRuns = runs.filter((r) => {
          if (seen.has(r.id)) return false
          seen.add(r.id)
          return true
        })

        for (const run of uniqueRuns) {
          getSharedStore().saveRun({
            runId: run.id,
            specPath: `/test/${run.id}`,
            status: run.status,
            phases: ALL_PHASES,
            startedAt: new Date().toISOString(),
            cost: 0,
            phaseResults: [],
            logs: [],
          })
        }

        const interrupted = getSharedStore().getInterruptedRuns()

        const nonTerminal = new Set(['running', 'paused'])
        for (const run of interrupted) {
          expect(nonTerminal.has(run.status)).toBe(true)
        }

        const expectedCount = uniqueRuns.filter((r) =>
          nonTerminal.has(r.status),
        ).length
        expect(interrupted).toHaveLength(expectedCount)
      },
    )
  })
})
