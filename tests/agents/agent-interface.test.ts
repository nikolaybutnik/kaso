import { describe, it, expect, vi } from 'vitest'
import { Agent, AgentRegistry } from '@/agents/agent-interface'
import { AgentContext, AgentResult, PhaseName } from '@/core/types'

describe('Agent Interface', () => {
  describe('compliance', () => {
    it('should validate complete agent implementation', () => {
      const validAgent: Agent = {
        execute: vi.fn<[], Promise<AgentResult>>(),
        supportsRollback: vi.fn().mockReturnValue(true),
        estimatedDuration: vi.fn().mockReturnValue(5000),
        requiredContext: vi.fn().mockReturnValue(['spec', 'config']),
      }

      expect(validAgent.execute).toBeDefined()
      expect(validAgent.supportsRollback).toBeDefined()
      expect(validAgent.estimatedDuration).toBeDefined()
      expect(validAgent.requiredContext).toBeDefined()

      // Should be able to call all methods
      validAgent.supportsRollback()
      validAgent.estimatedDuration()
      validAgent.requiredContext()

      expect(validAgent.supportsRollback()).toBe(true)
      expect(validAgent.estimatedDuration()).toBe(5000)
      expect(validAgent.requiredContext()).toEqual(['spec', 'config'])
    })

    it('should accept async execute method', async () => {
      const mockResult: AgentResult = {
        success: true,
        output: { test: 'data' },
        duration: 1000,
      }

      const agent: Agent = {
        execute: vi.fn().mockResolvedValue(mockResult),
        supportsRollback: () => false,
        estimatedDuration: () => 3000,
        requiredContext: () => [],
      }

      const context = {} as AgentContext
      const result = await agent.execute(context)

      expect(result).toEqual(mockResult)
      expect(agent.execute).toHaveBeenCalledWith(context)
    })

    it('should support agents with no required context', () => {
      const agent: Agent = {
        execute: vi.fn(),
        supportsRollback: () => true,
        estimatedDuration: () => 2000,
        requiredContext: () => [],
      }

      expect(agent.requiredContext()).toEqual([])
    })

    it('should support agents with multiple context requirements', () => {
      const agent: Agent = {
        execute: vi.fn(),
        supportsRollback: () => false,
        estimatedDuration: () => 15000,
        requiredContext: () => ['spec', 'architecture', 'config'],
      }

      const requirements = agent.requiredContext()
      expect(requirements).toHaveLength(3)
      expect(requirements).toContain('spec')
      expect(requirements).toContain('architecture')
      expect(requirements).toContain('config')
    })
  })

  describe('AgentResult type', () => {
    it('should support successful result', () => {
      const result: AgentResult = {
        success: true,
        output: { test: 'data' },
        duration: 5000,
        tokensUsed: 100,
      }

      expect(result.success).toBe(true)
      expect(result.output).toBeDefined()
      expect(result.duration).toBe(5000)
      expect(result.tokensUsed).toBe(100)
    })

    it('should support failed result', () => {
      const result: AgentResult = {
        success: false,
        error: {
          message: 'Test error',
          code: 'TEST_ERROR',
          retryable: true,
        },
      }

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.message).toBe('Test error')
      expect(result.error?.retryable).toBe(true)
    })
  })

  describe('AgentRegistry interface', () => {
    it('should allow registration with metadata', () => {
      const mockRegistrar: AgentRegistry = {
        register: vi.fn(),
        getAgentForPhase: vi.fn(),
        listRegistered: vi.fn().mockReturnValue([]),
      }

      const mockAgent: Agent = {
        execute: vi.fn(),
        supportsRollback: () => true,
        estimatedDuration: () => 5000,
        requiredContext: () => ['spec'],
      }

      mockRegistrar.register(
        'intake' as PhaseName,
        mockAgent,
        'Test Intake Agent',
      )

      expect(mockRegistrar.register).toHaveBeenCalledWith(
        'intake',
        mockAgent,
        'Test Intake Agent',
      )
    })

    it('should allow optional description', () => {
      const mockRegistrar: AgentRegistry = {
        register: vi.fn(),
        getAgentForPhase: vi.fn(),
        listRegistered: vi.fn(),
      }

      const mockAgent: Agent = {
        execute: vi.fn(),
        supportsRollback: () => false,
        estimatedDuration: () => 3000,
        requiredContext: () => [],
      }

      mockRegistrar.register(
        'validation' as PhaseName,
        mockAgent,
        'Validator',
        'Validates specifications for correctness',
      )

      expect(mockRegistrar.register).toHaveBeenCalledWith(
        'validation',
        mockAgent,
        'Validator',
        'Validates specifications for correctness',
      )
    })
  })
})
