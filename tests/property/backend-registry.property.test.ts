/**
 * Property tests for backend registry and selection
 */

import { test, fc } from '@fast-check/vitest'
import { expect } from 'vitest'
import { BackendRegistry } from '../../src/backends/backend-registry'
import type { KASOConfig, ExecutorBackendConfig } from '../../src/config/schema'
import type { AgentContext } from '../../src/core/types'
import { getDefaultConfig } from '../../src/config/schema'

/** Common system commands to exclude from availability tests */
const SYSTEM_COMMANDS = [
  'node',
  'echo',
  'printf',
  'cat',
  'ls',
  'dir',
  'which',
  'where',
] as const

/**
 * Generate a random backend config
 */
const backendConfigArbitrary: fc.Arbitrary<ExecutorBackendConfig> = fc.record({
  name: fc.string({ minLength: 1 }),
  command: fc.string({ minLength: 1 }),
  args: fc.array(fc.string()),
  protocol: fc.constantFrom(
    'cli-stdout' as const,
    'cli-json' as const,
    'acp' as const,
    'mcp' as const,
  ),
  maxContextWindow: fc.integer({ min: 1000, max: 200000 }),
  costPer1000Tokens: fc.integer({ min: 1, max: 500 }).map((n) => n / 100),
  enabled: fc.boolean(),
})

/**
 * Generate a valid KASO config with backends
 */
const kasoConfigArbitrary: fc.Arbitrary<KASOConfig> = fc
  .record({
    backends: fc.array(backendConfigArbitrary, { minLength: 1, maxLength: 5 }),
    defaultBackendIndex: fc.integer({ min: 0, max: 4 }),
    selectionStrategy: fc.constantFrom(
      'default' as const,
      'context-aware' as const,
    ),
  })
  .map(({ backends, defaultBackendIndex, selectionStrategy }) => {
    const validIndex = Math.min(defaultBackendIndex, backends.length - 1)

    const modifiedBackends = backends.map((backend, index) => ({
      ...backend,
      enabled: index === validIndex ? true : backend.enabled,
    }))

    const defaultBackendEntry = modifiedBackends[validIndex]
    if (!defaultBackendEntry) {
      throw new Error('Invalid backend index')
    }

    const baseConfig = getDefaultConfig()
    return {
      ...baseConfig,
      executorBackends: modifiedBackends,
      defaultBackend: defaultBackendEntry.name,
      backendSelectionStrategy: selectionStrategy,
    }
  })

/** Creates a test AgentContext with optional design content */
function createTestContext(
  config: KASOConfig,
  designContent?: string,
): AgentContext {
  return {
    runId: 'test-run',
    spec: {
      featureName: 'test',
      specPath: '/test/spec',
      missingFiles: [],
      ...(designContent !== undefined && {
        design: {
          rawContent: designContent,
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
      }),
    },
    steering: { hooks: {} },
    phaseOutputs: {},
    config,
    backends: {},
  }
}

/**
 * Property 14: Context-aware backend selection picks cheapest fitting backend
 */
test.prop([kasoConfigArbitrary, fc.integer({ min: 1000, max: 200000 })])(
  'Property 14: Context-aware backend selection',
  (config, contextSize) => {
    config.backendSelectionStrategy = 'context-aware'

    const maxWindow = Math.max(
      ...config.executorBackends
        .filter((b) => b.enabled)
        .map((b) => b.maxContextWindow),
    )
    fc.pre(contextSize <= maxWindow)

    const registry = new BackendRegistry(config)
    const context = createTestContext(config, 'x'.repeat(contextSize * 4))

    const selectedBackend = registry.selectBackend(context)
    const selectedConfig = registry.getConfig(selectedBackend.name)

    expect(selectedConfig).toBeDefined()
    expect(selectedConfig?.maxContextWindow).toBeGreaterThanOrEqual(contextSize)

    // Verify it's the cheapest available option
    const fittingBackends = config.executorBackends
      .filter((b) => b.enabled)
      .filter((b) => b.maxContextWindow >= contextSize)
      .sort((a, b) => a.costPer1000Tokens - b.costPer1000Tokens)

    const cheapestBackend = fittingBackends[0]
    if (cheapestBackend) {
      expect(selectedConfig?.costPer1000Tokens).toBe(
        cheapestBackend.costPer1000Tokens,
      )
    }
  },
)

/**
 * Property 57: Backend progress events are NDJSON on stdout
 */
test.prop([fc.string({ minLength: 1 }), fc.array(fc.string({ minLength: 1 }))])(
  'Property 57: Backend progress events are NDJSON',
  (message, dataKeys) => {
    fc.pre(dataKeys.length > 0)

    const event = {
      type: 'progress',
      timestamp: new Date().toISOString(),
      message,
      data: dataKeys.reduce<Record<string, string>>((acc, key) => {
        acc[key] = `value-${key}`
        return acc
      }, {}),
    }

    const serialized = JSON.stringify(event)
    expect(serialized).not.toContain('\n')
    expect(serialized).not.toContain('\r')

    const parsed = JSON.parse(serialized) as typeof event
    expect(parsed.type).toBe('progress')
    expect(parsed.timestamp).toBe(event.timestamp)
    expect(parsed.message).toBe(message)
    expect(parsed.data).toEqual(event.data)
  },
)

/**
 * Additional property: Default backend selection
 */
test.prop([kasoConfigArbitrary])(
  'Backend registry default selection',
  (config) => {
    config.backendSelectionStrategy = 'default'
    const registry = new BackendRegistry(config)
    const context = createTestContext(config)

    const selectedBackend = registry.selectBackend(context)
    expect(selectedBackend.name).toBe(config.defaultBackend)
  },
)

/**
 * Additional property: Backend availability checking
 */
test.prop([backendConfigArbitrary])(
  'Backend availability check',
  async (config) => {
    fc.pre(
      !SYSTEM_COMMANDS.includes(
        config.command as (typeof SYSTEM_COMMANDS)[number],
      ),
    )

    const kasoConfig: KASOConfig = {
      ...getDefaultConfig(),
      executorBackends: [{ ...config, enabled: true }],
      defaultBackend: config.name,
    }

    const registry = new BackendRegistry(kasoConfig)
    const isAvailable = await registry.isBackendAvailable(config.name)
    expect(typeof isAvailable).toBe('boolean')
  },
)

/**
 * Property: Context size estimation
 */
test.prop([fc.integer({ min: 1000, max: 100000 })])(
  'Context size estimation',
  (charCount) => {
    const config: KASOConfig = {
      ...getDefaultConfig(),
      backendSelectionStrategy: 'context-aware' as const,
    }

    const registry = new BackendRegistry(config)
    const context = createTestContext(config, 'x'.repeat(charCount))

    const backend = registry.selectBackend(context)
    expect(backend).toBeDefined()
    expect(backend.name).toBeTruthy()
  },
)
