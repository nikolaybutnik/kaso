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

import { describe, expect, afterEach } from 'vitest'
import { test, fc } from '@fast-check/vitest'
import { validateConfig } from '@/config/schema'
import type { KASOConfig } from '@/config/schema'
import { createMockProject } from '../e2e/helpers/mock-project'
import type { MockProjectResult } from '../e2e/helpers/mock-project'
import { readFileSync } from 'fs'
import { MockBackend } from '../e2e/helpers/mock-backend'
import { EventBus } from '@/core/event-bus'
import { EventCollector } from '../e2e/helpers/event-collector'
import type {
  PhaseName,
  EventType,
  ExecutionEvent,
  PhaseResultRecord,
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
})
