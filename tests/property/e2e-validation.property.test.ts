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
import type { PhaseName } from '@/core/types'

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
})
