/**
 * Property tests for configuration schema validation
 * Tests phaseBackends, reviewers, and cross-field validation
 */

import { test, fc } from '@fast-check/vitest'
import { expect } from 'vitest'
import {
  validateConfig,
  getDefaultConfig,
  type KASOConfig,
  type ExecutorBackendConfig,
} from '@/config/schema'

/**
 * Generate a valid executor backend config
 */
const backendConfigArbitrary: fc.Arbitrary<ExecutorBackendConfig> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }),
  command: fc.string({ minLength: 1, maxLength: 50 }),
  args: fc.array(fc.string({ maxLength: 50 })),
  protocol: fc.constantFrom(
    'cli-stdout' as const,
    'cli-json' as const,
    'acp' as const,
    'mcp' as const,
  ),
  maxContextWindow: fc.integer({ min: 1000, max: 200000 }),
  costPer1000Tokens: fc.float({ min: Math.fround(0.001), max: 1, noNaN: true }),
  enabled: fc.boolean(),
})

/**
 * Generate valid built-in phase names
 */
const builtInPhaseArbitrary: fc.Arbitrary<string> = fc.constantFrom(
  'intake',
  'validation',
  'architecture-analysis',
  'implementation',
  'architecture-review',
  'test-verification',
  'ui-validation',
  'review-delivery',
)

/**
 * Generate valid custom phase names
 */
const customPhaseArbitrary: fc.Arbitrary<string> = fc
  .string({ minLength: 1, maxLength: 30 })
  .filter((s) => /^[a-z0-9-]+$/.test(s))
  .map((s) => `custom-${s}`)

/**
 * Generate any valid phase name
 */
const phaseNameArbitrary: fc.Arbitrary<string> = fc.oneof(
  builtInPhaseArbitrary,
  customPhaseArbitrary,
)

/**
 * Property 1: Valid config schema round-trip
 * Validates: Requirements 1.1, 1.2, 1.5, 4.1, 5.3
 */
test.prop([fc.array(backendConfigArbitrary, { minLength: 1, maxLength: 5 })])(
  'valid config survives parse/serialize round-trip',
  (backends) => {
    // Create a valid config with the generated backends
    const defaultBackend = backends[0]!.name
    const config: KASOConfig = {
      ...getDefaultConfig(),
      executorBackends: backends,
      defaultBackend,
      phaseBackends: {},
      reviewCouncil: {
        maxReviewRounds: 2,
        enableParallelReview: false,
        perspectives: ['security', 'performance', 'maintainability'],
      },
    }

    // Serialize and re-parse should produce equivalent config
    const serialized = JSON.parse(JSON.stringify(config))
    const result = validateConfig(serialized)

    expect(result.executorBackends).toHaveLength(backends.length)
    expect(result.defaultBackend).toBe(defaultBackend)
  },
)

/**
 * Property 2: Cross-field backend reference rejection - missing backend
 * Validates: Requirements 1.3, 1.4, 6.3, 6.4, 10.1, 10.2, 10.3
 */
test.prop([fc.string({ minLength: 1 }), fc.string({ minLength: 1 })])(
  'invalid backend references in phaseBackends are rejected',
  (existingBackend, invalidBackend) => {
    // Ensure the backends are different
    const safeInvalidBackend =
      invalidBackend === existingBackend
        ? `${invalidBackend}-x`
        : invalidBackend

    const config = {
      ...getDefaultConfig(),
      executorBackends: [
        {
          name: existingBackend,
          command: 'test',
          args: [],
          protocol: 'cli-json' as const,
          maxContextWindow: 128000,
          costPer1000Tokens: 0.01,
          enabled: true,
        },
      ],
      defaultBackend: existingBackend,
      phaseBackends: {
        intake: safeInvalidBackend,
      },
    }

    expect(() => validateConfig(config)).toThrow(/not found/)
  },
)

/**
 * Property: Disabled backend references are rejected
 * Validates: Requirements 1.3, 1.4, 6.3, 6.4, 10.1, 10.2, 10.3
 */
test.prop([fc.string({ minLength: 1 })])(
  'disabled backend references in phaseBackends are rejected',
  (backendName) => {
    const config = {
      ...getDefaultConfig(),
      executorBackends: [
        {
          name: backendName,
          command: 'test',
          args: [],
          protocol: 'cli-json' as const,
          maxContextWindow: 128000,
          costPer1000Tokens: 0.01,
          enabled: false,
        },
      ],
      defaultBackend: backendName,
      phaseBackends: {
        intake: backendName,
      },
    }

    expect(() => validateConfig(config)).toThrow(/disabled/)
  },
)

/**
 * Property 10: Unique role validation rejects duplicates
 * Validates: Requirement 4.7
 */
test.prop([fc.string({ minLength: 1 }), fc.string({ minLength: 1 })])(
  'duplicate reviewer roles are rejected',
  (role, backendName) => {
    const config = {
      ...getDefaultConfig(),
      executorBackends: [
        {
          name: backendName,
          command: 'test',
          args: [],
          protocol: 'cli-json' as const,
          maxContextWindow: 128000,
          costPer1000Tokens: 0.01,
          enabled: true,
        },
      ],
      defaultBackend: backendName,
      reviewCouncil: {
        reviewers: [
          { role, backend: backendName },
          { role, backend: backendName }, // Duplicate role
        ],
      },
    }

    expect(() => validateConfig(config)).toThrow(/unique/i)
  },
)

/**
 * Property: Valid phaseBackends with valid backends are accepted
 * Validates: Requirements 1.1, 1.2, 3.1
 */
test.prop([fc.string({ minLength: 1 }), phaseNameArbitrary])(
  'valid phaseBackends configuration is accepted',
  (backendName: string, phase: string) => {
    const config = {
      ...getDefaultConfig(),
      executorBackends: [
        {
          name: backendName,
          command: 'test',
          args: [],
          protocol: 'cli-json' as const,
          maxContextWindow: 128000,
          costPer1000Tokens: 0.01,
          enabled: true,
        },
      ],
      defaultBackend: backendName,
      phaseBackends: {
        [phase]: backendName,
      },
    }

    const result = validateConfig(config)
    expect(result.phaseBackends[phase]).toBe(backendName)
  },
)

/**
 * Property: Valid reviewers with valid backends are accepted
 * Validates: Requirements 4.1, 4.5, 4.6, 6.1, 6.2
 */
test.prop([fc.string({ minLength: 1 }), fc.string({ minLength: 1 })])(
  'valid reviewers configuration is accepted',
  (backendName: string, role: string) => {
    const config = {
      ...getDefaultConfig(),
      executorBackends: [
        {
          name: backendName,
          command: 'test',
          args: [],
          protocol: 'cli-json' as const,
          maxContextWindow: 128000,
          costPer1000Tokens: 0.01,
          enabled: true,
        },
      ],
      defaultBackend: backendName,
      reviewCouncil: {
        reviewers: [{ role, backend: backendName }],
      },
    }

    const result = validateConfig(config)
    expect(result.reviewCouncil.reviewers).toHaveLength(1)
    const reviewers = result.reviewCouncil.reviewers!
    expect(reviewers[0]!.role).toBe(role)
    expect(reviewers[0]!.backend).toBe(backendName)
  },
)

/**
 * Property: Reviewers without explicit backend are accepted
 * Validates: Requirement 4.5 (backend is optional)
 */
test.prop([fc.string({ minLength: 1 })])(
  'reviewers without backend field are accepted',
  (role: string) => {
    const config = {
      ...getDefaultConfig(),
      reviewCouncil: {
        reviewers: [{ role }],
      },
    }

    const result = validateConfig(config)
    const reviewers = result.reviewCouncil.reviewers!
    expect(reviewers).toHaveLength(1)
    expect(reviewers[0]!.role).toBe(role)
    expect(reviewers[0]!.backend).toBeUndefined()
  },
)

/**
 * Property: Empty phaseBackends is accepted
 * Validates: Requirement 1.2
 */
test('empty phaseBackends object is accepted', () => {
  const config = {
    ...getDefaultConfig(),
    phaseBackends: {},
  }

  const result = validateConfig(config)
  expect(result.phaseBackends).toEqual({})
})

/**
 * Property: Config without reviewers uses default perspectives
 * Validates: Requirement 5.3 (backward compatibility)
 */
test('config without reviewers maintains backward compatibility', () => {
  const config = {
    ...getDefaultConfig(),
    reviewCouncil: {},
  }

  const result = validateConfig(config)
  expect(result.reviewCouncil.perspectives).toEqual([
    'security',
    'performance',
    'maintainability',
  ])
  expect(result.reviewCouncil.reviewers).toBeUndefined()
})

/**
 * Property: Invalid reviewer backend reference is rejected
 * Validates: Requirements 6.3, 6.4, 10.1, 10.2, 10.3
 */
test.prop([
  fc.string({ minLength: 1 }),
  fc.string({ minLength: 1 }),
  fc.string({ minLength: 1 }),
])(
  'invalid backend reference in reviewers is rejected',
  (existingBackend: string, role: string, invalidBackend: string) => {
    const safeInvalidBackend =
      invalidBackend === existingBackend
        ? `${invalidBackend}-x`
        : invalidBackend

    const config = {
      ...getDefaultConfig(),
      executorBackends: [
        {
          name: existingBackend,
          command: 'test',
          args: [],
          protocol: 'cli-json' as const,
          maxContextWindow: 128000,
          costPer1000Tokens: 0.01,
          enabled: true,
        },
      ],
      defaultBackend: existingBackend,
      reviewCouncil: {
        reviewers: [{ role, backend: safeInvalidBackend }],
      },
    }

    expect(() => validateConfig(config)).toThrow(/not found/)
  },
)
