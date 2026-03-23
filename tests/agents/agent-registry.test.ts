import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentRegistryImpl } from '@/agents/agent-registry'
import { Agent } from '@/agents/agent-interface'
import { PhaseName } from '@/core/types'

describe('AgentRegistry', () => {
  let registry: AgentRegistryImpl

  beforeEach(() => {
    registry = new AgentRegistryImpl()
  })

  describe('register', () => {
    it('should register a valid agent', () => {
      const mockAgent: Agent = {
        execute: vi.fn(),
        supportsRollback: vi.fn().mockReturnValue(true),
        estimatedDuration: vi.fn().mockReturnValue(5000),
        requiredContext: vi.fn().mockReturnValue(['spec']),
      }

      registry.register('intake' as PhaseName, mockAgent, 'Test Agent')

      expect(registry.getAgentCount()).toBe(1)
      expect(registry.hasAgentForPhase('intake' as PhaseName)).toBe(true)
    })

    it('should validate all four required methods', () => {
      const incompleteAgent: Partial<Agent> = {
        execute: vi.fn(),
        supportsRollback: vi.fn().mockReturnValue(true),
        // Missing estimatedDuration and requiredContext
      }

      expect(() => {
        registry.register(
          'intake' as PhaseName,
          incompleteAgent as Agent,
          'Incomplete Agent',
        )
      }).toThrow(/missing.*estimatedDuration|missing.*requiredContext/i)
    })

    it('should reject agent with missing execute method', () => {
      const badAgent: Partial<Agent> = {
        supportsRollback: () => true,
        estimatedDuration: () => 5000,
        requiredContext: () => [],
        // Missing execute
      }

      expect(() => {
        registry.register('intake' as PhaseName, badAgent as Agent, 'Bad Agent')
      }).toThrow(/missing.*execute/i)
    })

    it('should reject agent with non-boolean supportsRollback', () => {
      const badAgent: Partial<Agent> = {
        execute: vi.fn(),
        supportsRollback: (() => 'yes') as any, // Wrong return type
        estimatedDuration: () => 5000,
        requiredContext: () => [],
      }

      expect(() => {
        registry.register('intake' as PhaseName, badAgent as Agent, 'Bad Agent')
      }).toThrow(/supportsRollback.*must return boolean/i)
    })

    it('should reject agent with negative estimatedDuration', () => {
      const badAgent: Partial<Agent> = {
        execute: vi.fn(),
        supportsRollback: () => true,
        estimatedDuration: () => -1000, // Negative
        requiredContext: () => [],
      }

      expect(() => {
        registry.register('intake' as PhaseName, badAgent as Agent, 'Bad Agent')
      }).toThrow(/estimatedDuration.*must return non-negative number/i)
    })

    it('should reject agent with non-array requiredContext', () => {
      const badAgent: Partial<Agent> = {
        execute: vi.fn(),
        supportsRollback: () => true,
        estimatedDuration: () => 5000,
        requiredContext: (() => 'spec') as any, // Not an array
      }

      expect(() => {
        registry.register('intake' as PhaseName, badAgent as Agent, 'Bad Agent')
      }).toThrow(/requiredContext.*must return array of strings/i)
    })

    it('should reject agent with non-string array requiredContext', () => {
      const badAgent: Partial<Agent> = {
        execute: vi.fn(),
        supportsRollback: () => true,
        estimatedDuration: () => 5000,
        requiredContext: (() => [123, 'spec']) as any, // Mixed types
      }

      expect(() => {
        registry.register('intake' as PhaseName, badAgent as Agent, 'Bad Agent')
      }).toThrow(/requiredContext.*must return array of strings/i)
    })

    it('should allow overriding agent for same phase', () => {
      const agent1: Agent = {
        execute: vi.fn(),
        supportsRollback: () => true,
        estimatedDuration: () => 5000,
        requiredContext: () => [],
      }

      const agent2: Agent = {
        execute: vi.fn(),
        supportsRollback: () => false,
        estimatedDuration: () => 3000,
        requiredContext: () => ['spec'],
      }

      registry.register('intake' as PhaseName, agent1, 'Agent 1')
      registry.register('intake' as PhaseName, agent2, 'Agent 2')

      expect(registry.getAgentCount()).toBe(1)
      expect(registry.getAgentForPhase('intake' as PhaseName)).toBe(agent2)
    })

    it('should store and return agent metadata', () => {
      const mockAgent: Agent = {
        execute: vi.fn(),
        supportsRollback: () => true,
        estimatedDuration: () => 5000,
        requiredContext: () => ['spec'],
      }

      registry.register(
        'intake' as PhaseName,
        mockAgent,
        'Test Agent',
        'Test description',
      )

      const metadata = registry.getAgentMetadata('intake' as PhaseName)
      expect(metadata).toBeDefined()
      expect(metadata?.name).toBe('Test Agent')
      expect(metadata?.description).toBe('Test description')
      expect(metadata?.phase).toBe('intake')
      expect(metadata?.agent).toBe(mockAgent)
    })
  })

  describe('getAgentForPhase', () => {
    it('should return agent for registered phase', () => {
      const mockAgent: Agent = {
        execute: vi.fn(),
        supportsRollback: () => true,
        estimatedDuration: () => 5000,
        requiredContext: () => [],
      }

      registry.register('intake' as PhaseName, mockAgent, 'Intake Agent')

      const retrieved = registry.getAgentForPhase('intake' as PhaseName)
      expect(retrieved).toBe(mockAgent)
    })

    it('should return undefined for unregistered phase', () => {
      const retrieved = registry.getAgentForPhase('intake' as PhaseName)
      expect(retrieved).toBeUndefined()
    })

    it('should handle multiple phases', () => {
      const intakeAgent: Agent = {
        execute: vi.fn(),
        supportsRollback: () => true,
        estimatedDuration: () => 5000,
        requiredContext: () => [],
      }

      const validationAgent: Agent = {
        execute: vi.fn(),
        supportsRollback: () => false,
        estimatedDuration: () => 3000,
        requiredContext: () => [],
      }

      registry.register('intake' as PhaseName, intakeAgent, 'Intake')
      registry.register(
        'validation' as PhaseName,
        validationAgent,
        'Validation',
      )

      expect(registry.getAgentForPhase('intake' as PhaseName)).toBe(intakeAgent)
      expect(registry.getAgentForPhase('validation' as PhaseName)).toBe(
        validationAgent,
      )
      expect(registry.getAgentCount()).toBe(2)
    })
  })

  describe('listRegistered', () => {
    it('should return empty array when no agents registered', () => {
      const registered = registry.listRegistered()
      expect(registered).toEqual([])
    })

    it('should list all registered agents', () => {
      const agent1: Agent = {
        execute: vi.fn(),
        supportsRollback: () => true,
        estimatedDuration: () => 5000,
        requiredContext: () => [],
      }

      const agent2: Agent = {
        execute: vi.fn(),
        supportsRollback: () => false,
        estimatedDuration: () => 3000,
        requiredContext: () => [],
      }

      registry.register('intake' as PhaseName, agent1, 'Intake', 'First agent')
      registry.register(
        'validation' as PhaseName,
        agent2,
        'Validation',
        'Second agent',
      )

      const registered = registry.listRegistered()
      expect(registered).toHaveLength(2)

      const intakeMetadata = registered.find((r) => r.phase === 'intake')
      expect(intakeMetadata).toBeDefined()
      expect(intakeMetadata?.name).toBe('Intake')
      expect(intakeMetadata?.description).toBe('First agent')

      const validationMetadata = registered.find(
        (r) => r.phase === 'validation',
      )
      expect(validationMetadata).toBeDefined()
      expect(validationMetadata?.name).toBe('Validation')
      expect(validationMetadata?.description).toBe('Second agent')
    })
  })

  describe('unregister', () => {
    it('should remove agent for phase', () => {
      const mockAgent: Agent = {
        execute: vi.fn(),
        supportsRollback: () => true,
        estimatedDuration: () => 5000,
        requiredContext: () => [],
      }

      registry.register('intake' as PhaseName, mockAgent, 'Test Agent')
      expect(registry.getAgentCount()).toBe(1)

      const unregistered = registry.unregister('intake' as PhaseName)
      expect(unregistered).toBe(true)
      expect(registry.getAgentCount()).toBe(0)
      expect(registry.hasAgentForPhase('intake' as PhaseName)).toBe(false)
    })

    it('should return false for unregistered phase', () => {
      const unregistered = registry.unregister('intake' as PhaseName)
      expect(unregistered).toBe(false)
    })
  })

  describe('hasAgentForPhase', () => {
    it('should check if agent is registered for phase', () => {
      const mockAgent: Agent = {
        execute: vi.fn(),
        supportsRollback: () => true,
        estimatedDuration: () => 5000,
        requiredContext: () => [],
      }

      expect(registry.hasAgentForPhase('intake' as PhaseName)).toBe(false)

      registry.register('intake' as PhaseName, mockAgent, 'Test')

      expect(registry.hasAgentForPhase('intake' as PhaseName)).toBe(true)
      expect(registry.hasAgentForPhase('validation' as PhaseName)).toBe(false)
    })
  })
})
