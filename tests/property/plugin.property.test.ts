/**
 * Property-based tests for Plugins and Custom Phases
 *
 * Properties:
 * - Property 43: Custom phase error handling matches built-in phases
 * - Property 48: Plugin discovery loads configured plugins
 *
 * Requirements: 22.2, 22.3, 23.3
 */

import { describe, it, expect } from 'vitest'
import * as fc from 'fast-check'
import {
  validateAgentInterface,
  loadAllPlugins,
  createPluginLoader,
} from '@/plugins/plugin-loader'
import {
  injectCustomPhases,
  validateCustomPhaseName,
  validatePosition,
  BUILTIN_PHASES,
  createPhaseInjector,
} from '@/plugins/phase-injector'
import type { PluginConfig } from '@/config/schema'
import type { CustomPhaseConfig } from '@/config/schema'
import { AgentRegistryImpl } from '@/agents/agent-registry'

// =============================================================================
// Property 48: Plugin discovery loads configured plugins
// =============================================================================

describe('Property 48: Plugin discovery loads configured plugins', () => {
  it('should handle any array of plugin configs', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            package: fc.string({ minLength: 1, maxLength: 50 }),
            enabled: fc.boolean(),
          }),
          { minLength: 0, maxLength: 10 },
        ),
        async (configs) => {
          const pluginConfigs: PluginConfig[] = configs.map((c) => ({
            package: c.package,
            enabled: c.enabled,
            config: {},
          }))

          const results = await loadAllPlugins(pluginConfigs)

          expect(results).toHaveLength(configs.length)
          // All should have a result (success or failure)
          expect(results.every((r) => r.package !== undefined)).toBe(true)
        },
      ),
      { numRuns: 20 },
    )
  })

  it('should reject disabled plugins', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 50 }),
        async (packageName) => {
          const configs: PluginConfig[] = [
            {
              package: packageName,
              enabled: false,
              config: {},
            },
          ]

          const results = await loadAllPlugins(configs)

          expect(results).toHaveLength(1)
          const firstResult = results[0]!
          expect(firstResult.success).toBe(false)
          expect(firstResult.error).toBeDefined()
          expect(firstResult.error).toBe('Plugin is disabled')
        },
      ),
      { numRuns: 20 },
    )
  })

  it('should validate agent interface for any object structure', async () => {
    await fc.assert(
      fc.property(fc.object(), (obj) => {
        const result = validateAgentInterface(obj)

        // Result should always be a boolean with error array
        expect(typeof result.valid).toBe('boolean')
        expect(Array.isArray(result.errors)).toBe(true)

        // If not valid, should have at least one error
        if (!result.valid) {
          expect(result.errors.length).toBeGreaterThan(0)
        }

        return true
      }),
      { numRuns: 100 },
    )
  })

  it('should track load results correctly', async () => {
    const agentRegistry = new AgentRegistryImpl()

    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            package: fc.string({ minLength: 1, maxLength: 30 }),
            enabled: fc.boolean(),
          }),
          { minLength: 0, maxLength: 5 },
        ),
        async (configs) => {
          const pluginConfigs: PluginConfig[] = configs.map((c) => ({
            package: c.package,
            enabled: c.enabled,
            config: {},
          }))

          const loader = createPluginLoader(agentRegistry, pluginConfigs)
          const results = await loader.loadAndRegister()

          // Verify counts match
          expect(results.length).toBe(configs.length)
          expect(loader.getResults().length).toBe(configs.length)

          // Successful + failed should equal total
          const successful = loader.getSuccessfulLoads()
          const failed = loader.getFailedLoads()
          expect(successful.length + failed.length).toBe(configs.length)

          return true
        },
      ),
      { numRuns: 15 },
    )
  })
})

// =============================================================================
// Property 43: Custom phase error handling matches built-in phases
// =============================================================================

describe('Property 43: Custom phase error handling matches built-in phases', () => {
  it('should accept valid custom phase names', async () => {
    await fc.assert(
      fc.property(
        fc
          .string({ minLength: 1, maxLength: 30 })
          .filter((s) => /^[a-z0-9-]+$/.test(s)),
        (suffix) => {
          const name = `custom-${suffix}`
          const result = validateCustomPhaseName(name)

          // Should be valid for valid patterns
          if (/^custom-[a-z0-9-]+$/.test(name)) {
            expect(result.valid).toBe(true)
          }

          return true
        },
      ),
      { numRuns: 50 },
    )
  })

  it('should reject invalid custom phase names', async () => {
    await fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 30 }), (name) => {
        const result = validateCustomPhaseName(name)

        // Should be invalid if doesn't start with custom- or has invalid chars
        if (!name.startsWith('custom-') || !/^custom-[a-z0-9-]+$/.test(name)) {
          expect(result.valid).toBe(false)
        }

        return true
      }),
      { numRuns: 100 },
    )
  })

  it('should accept valid positions', async () => {
    await fc.assert(
      fc.property(
        fc.integer({ min: 0, max: BUILTIN_PHASES.length }),
        (position) => {
          const result = validatePosition(position)
          expect(result.valid).toBe(true)
          return true
        },
      ),
      { numRuns: 50 },
    )
  })

  it('should reject invalid positions', async () => {
    await fc.assert(
      fc.property(
        fc.integer().filter((n) => n < 0 || n > BUILTIN_PHASES.length),
        (position) => {
          const result = validatePosition(position)
          expect(result.valid).toBe(false)
          return true
        },
      ),
      { numRuns: 50 },
    )
  })

  it('should preserve all built-in phases after injection', async () => {
    await fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc
              .string({ minLength: 5, maxLength: 30 })
              .map((s) => `custom-${s.replace(/[^a-z0-9-]/g, '-')}`),
            position: fc.integer({ min: 0, max: 8 }),
          }),
          { minLength: 0, maxLength: 5 },
        ),
        (customPhases) => {
          // Filter for valid phase names
          const validPhases = customPhases.filter((p) =>
            /^custom-[a-z0-9-]+$/.test(p.name),
          )

          // Remove duplicates
          const uniquePhases = Array.from(
            new Map(validPhases.map((p) => [p.name, p])).values(),
          )

          const configs: CustomPhaseConfig[] = uniquePhases.map((p) => ({
            name: p.name as `custom-${string}`,
            package: 'test-pkg',
            position: p.position,
            config: {},
          }))

          const result = injectCustomPhases(configs)

          // All built-in phases should still be present
          const phaseNames = result.phases.map((p) => p.name)
          for (const builtin of BUILTIN_PHASES) {
            expect(phaseNames).toContain(builtin)
          }

          return true
        },
      ),
      { numRuns: 20 },
    )
  })

  it('should report errors for invalid configurations', async () => {
    await fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 30 }),
            position: fc.integer({ min: -5, max: 15 }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        (phases) => {
          const configs: CustomPhaseConfig[] = phases.map((p) => ({
            name: p.name as `custom-${string}`,
            package: 'test-pkg',
            position: p.position,
            config: {},
          }))

          const result = injectCustomPhases(configs)

          // Should have some phases (valid or invalid)
          expect(result.phases.length).toBeGreaterThanOrEqual(
            BUILTIN_PHASES.length,
          )

          // If there are invalid configs, should have errors
          const hasInvalid = phases.some(
            (p) =>
              !p.name.startsWith('custom-') || p.position < 0 || p.position > 8,
          )

          if (hasInvalid) {
            expect(result.errors.length).toBeGreaterThan(0)
          }

          return true
        },
      ),
      { numRuns: 20 },
    )
  })

  it('should handle duplicate phase names gracefully', async () => {
    await fc.assert(
      fc.property(
        fc
          .string({ minLength: 5, maxLength: 20 })
          .map((s) => `custom-${s.replace(/[^a-z0-9]/g, '-')}`),
        fc.integer({ min: 0, max: 8 }),
        fc.integer({ min: 0, max: 8 }),
        (name, pos1, pos2) => {
          if (pos1 === pos2) return true

          const configs: CustomPhaseConfig[] = [
            {
              name: name as `custom-${string}`,
              package: 'pkg1',
              position: pos1,
              config: {},
            },
            {
              name: name as `custom-${string}`,
              package: 'pkg2',
              position: pos2,
              config: {},
            },
          ]

          const result = injectCustomPhases(configs)

          // Should report duplicate error
          expect(result.errors.some((e) => e.includes('Duplicate'))).toBe(true)

          return true
        },
      ),
      { numRuns: 20 },
    )
  })
})

// =============================================================================
// Integration Property Tests
// =============================================================================

describe('Plugin and Phase Integration Properties', () => {
  it('should handle empty configurations', () => {
    const injector = createPhaseInjector([])
    const result = injector.buildPipeline()

    expect(result.phases).toHaveLength(BUILTIN_PHASES.length)
    expect(result.errors).toHaveLength(0)
  })

  it('should handle maximum custom phases', async () => {
    await fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc
              .string({ minLength: 5, maxLength: 15 })
              .map((s) => `custom-${s.replace(/[^a-z0-9-]/g, '-')}`),
            position: fc.integer({ min: 0, max: 8 }),
          }),
          { minLength: 0, maxLength: 10 },
        ),
        (phases) => {
          // Filter valid and unique
          const validPhases = phases
            .filter((p) => /^custom-[a-z0-9-]+$/.test(p.name))
            .filter(
              (p, i, arr) => arr.findIndex((q) => q.name === p.name) === i,
            )

          const configs: CustomPhaseConfig[] = validPhases.map((p) => ({
            name: p.name as `custom-${string}`,
            package: 'test-pkg',
            position: p.position,
            config: {},
          }))

          const result = injectCustomPhases(configs)

          // Total phases should be built-in + successful custom
          expect(result.phases.length).toBeGreaterThanOrEqual(
            BUILTIN_PHASES.length,
          )

          // All phases should have valid types
          expect(
            result.phases.every(
              (p) => p.type === 'built-in' || p.type === 'custom',
            ),
          ).toBe(true)

          return true
        },
      ),
      { numRuns: 20 },
    )
  })
})
