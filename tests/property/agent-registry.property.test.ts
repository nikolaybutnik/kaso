import { test, fc } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { AgentRegistryImpl } from '@/agents/agent-registry'
import { Agent } from '@/agents/agent-interface'
import { PhaseName } from '@/core/types'

describe('Property 8: Agent registration validates interface completeness', () => {
  /**
   * Property 8: Agent registration validates interface completeness
   * For any agent that is missing any required interface method,
   * the registry SHALL reject registration with a clear error message.
   *
   * Validates: Requirements 5.5, 22.3
   */

  const validAgentMethods = {
    execute: async () => ({ success: true }),
    supportsRollback: () => true,
    estimatedDuration: () => 5000,
    requiredContext: () => ['spec'],
  }

  test.prop([
    fc.record(
      {
        execute: fc.boolean(),
        supportsRollback: fc.boolean(),
        estimatedDuration: fc.boolean(),
        requiredContext: fc.boolean(),
      },
      { requiredKeys: [] },
    ),
  ])('should only accept agents with all four methods', async (methods) => {
    const registry = new AgentRegistryImpl()

    // Build agent with missing methods
    const agent: Partial<Agent> = {}
    const presentMethods: string[] = []
    if (methods.execute) {
      agent.execute = validAgentMethods.execute
      presentMethods.push('execute')
    }
    if (methods.supportsRollback) {
      agent.supportsRollback = validAgentMethods.supportsRollback
      presentMethods.push('supportsRollback')
    }
    if (methods.estimatedDuration) {
      agent.estimatedDuration = validAgentMethods.estimatedDuration
      presentMethods.push('estimatedDuration')
    }
    if (methods.requiredContext) {
      agent.requiredContext = validAgentMethods.requiredContext
      presentMethods.push('requiredContext')
    }

    // Should only succeed if all methods present
    const hasAllMethods = presentMethods.length === 4

    if (hasAllMethods) {
      registry.register('intake' as PhaseName, agent as Agent, 'Test Agent')
      expect(registry.getAgentCount()).toBe(1)
    } else {
      expect(() => {
        registry.register('intake' as PhaseName, agent as Agent, 'Test Agent')
      }).toThrow(/missing|must return/i)
      expect(registry.getAgentCount()).toBe(0)
    }
  })

  /**
   * Additional property: Valid agents always register successfully
   * For any agent that implements all required methods correctly,
   * registration SHALL succeed and the agent SHALL be retrievable.
   */
  test.prop([
    fc.record({
      supportsRollback: fc.boolean(),
      estimatedDuration: fc.integer({ min: 0, max: 3600000 }), // Up to 1 hour
      requiredContext: fc.array(fc.string({ minLength: 1, maxLength: 20 }), {
        maxLength: 5,
      }),
      name: fc.string({ minLength: 5, maxLength: 50 }),
      description: fc.string({ minLength: 0, maxLength: 100 }),
    }),
  ])(
    'should register valid agents with any parameter values',
    async ({
      supportsRollback,
      estimatedDuration,
      requiredContext,
      name,
      description,
    }) => {
      const registry = new AgentRegistryImpl()

      const agent: Agent = {
        execute: async () => ({ success: true }),
        supportsRollback: () => supportsRollback,
        estimatedDuration: () => estimatedDuration,
        requiredContext: () => requiredContext,
      }

      const shouldPass = true // All methods are implemented

      if (shouldPass) {
        registry.register(
          'intake' as PhaseName,
          agent,
          name,
          description || undefined,
        )

        expect(registry.getAgentCount()).toBe(1)
        expect(registry.hasAgentForPhase('intake' as PhaseName)).toBe(true)

        const retrieved = registry.getAgentForPhase('intake' as PhaseName)
        expect(retrieved).toBe(agent)

        const metadata = registry.getAgentMetadata('intake' as PhaseName)
        expect(metadata?.name).toBe(name)
        expect(metadata?.description).toBe(description || undefined)
        expect(metadata?.phase).toBe('intake')
      }
    },
  )
})
