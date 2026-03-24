/**
 * Unit tests for Executor Agent (Phase 4 - Implementation)
 * Tests backend delegation, self-correction, and progress streaming
 */

import { describe, it, expect } from 'vitest'
import { ExecutorAgent, createExecutorAgent } from '../../src/agents/executor'
import { MockBackend } from '../../src/backends/backend-process'
import { BackendRegistry } from '../../src/backends/backend-registry'
import type {
  AgentContext,
  AssembledContext,
  ValidationReport,
  ArchitectureContext,
  ImplementationResult,
  SteeringFiles,
} from '../../src/core/types'
import type { KASOConfig, ExecutorBackendConfig } from '../../src/config/schema'
import { EventBus } from '../../src/core/event-bus'

// Helper to create minimal AgentContext
function createMockContext(
  overrides: Partial<AgentContext> = {},
  worktreePath?: string,
): AgentContext {
  const mockSteering: SteeringFiles = {
    hooks: {},
  }

  const mockConfig: KASOConfig = {
    executorBackends: [
      {
        name: 'mock-backend',
        command: 'echo',
        args: [],
        protocol: 'cli-json',
        maxContextWindow: 128000,
        costPer1000Tokens: 0.01,
        enabled: true,
      } as ExecutorBackendConfig,
    ],
    defaultBackend: 'mock-backend',
    backendSelectionStrategy: 'default',
    maxConcurrentAgents: 1,
    maxPhaseRetries: 2,
    defaultPhaseTimeout: 300,
    phaseTimeouts: {},
    contextCapping: {
      enabled: true,
      charsPerToken: 4,
      relevanceRanking: ['design.md', 'tech-spec.md', 'task.md'],
    },
    uiBaseline: {
      baselineDir: '.kiro/ui-baselines',
      captureOnPass: true,
      diffThreshold: 0.1,
      viewport: { width: 1280, height: 720 },
    },
    executionStore: {
      type: 'sqlite',
      path: '.kaso/execution-store.db',
    },
    reviewCouncil: {
      maxReviewRounds: 2,
      enableParallelReview: true,
      perspectives: ['security', 'performance', 'maintainability'],
    },
    webhooks: [],
    mcpServers: [],
    plugins: [],
    customPhases: [],
  }

  const mockAssembledContext: AssembledContext = {
    featureName: 'test-feature',
    designDoc: {
      rawContent: '# Design\n\nTest design doc',
      sections: [],
      codeBlocks: [],
      metadata: {},
    },
    techSpec: {
      rawContent: '# Tech Spec\n\nTest tech spec',
      sections: [],
      codeBlocks: [],
      metadata: {},
    },
    taskList: [],
    architectureDocs: {},
    dependencies: {},
    removedFiles: [],
  }

  const mockValidationReport: ValidationReport = {
    approved: true,
    issues: [],
    suggestedFixes: [],
  }

  const mockArchitectureContext: ArchitectureContext = {
    patterns: [],
    moduleBoundaries: [],
    adrs: {},
    adrsFound: 0,
    potentialViolations: [],
  }

  return {
    runId: 'test-run-id',
    spec: {
      featureName: 'test-feature',
      specPath: '/test/spec',
      missingFiles: [],
    },
    steering: mockSteering,
    phaseOutputs: {
      intake: mockAssembledContext,
      validation: mockValidationReport,
    },
    architecture: mockArchitectureContext,
    config: mockConfig,
    worktreePath,
    backends: {
      'mock-backend': mockConfig.executorBackends[0]!,
    },
    ...overrides,
  }
}

// Helper to create an agent with a mock backend
function createAgentWithMockBackend(
  eventBus?: EventBus,
  backendName = 'mock-backend',
): { agent: ExecutorAgent; mockBackend: MockBackend; registry: BackendRegistry } {
  const mockBackend = new MockBackend(backendName, true)
  const config = createMockContext().config
  const registry = new BackendRegistry(config)
  registry.registerBackend(backendName, mockBackend)
  const agent = createExecutorAgent(eventBus, registry)
  return { agent, mockBackend, registry }
}

describe('ExecutorAgent', () => {
  describe('Agent Interface', () => {
    it('should implement Agent interface', () => {
      const agent = createExecutorAgent()

      expect(agent.supportsRollback()).toBe(true)
      expect(agent.estimatedDuration()).toBe(60000)
      expect(agent.requiredContext()).toContain('phaseOutputs.intake')
      expect(agent.requiredContext()).toContain('phaseOutputs.validation')
      expect(agent.requiredContext()).toContain('architecture')
      expect(agent.requiredContext()).toContain('worktreePath')
    })

    it('should require worktree path for file operations', () => {
      const agent = createExecutorAgent()

      expect(agent.requiredContext()).toContain('worktreePath')
    })
  })

  describe('Context Validation', () => {
    it('should fail when intake phase output is missing', async () => {
      const { agent } = createAgentWithMockBackend()
      const context = createMockContext(
        {
          phaseOutputs: {},
          worktreePath: '/tmp/test',
        },
        '/tmp/test',
      )

      const result = await agent.execute(context)

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('Missing intake phase output')
    })

    it('should fail when validation phase output is missing', async () => {
      const { agent } = createAgentWithMockBackend()
      const context = createMockContext(
        {
          phaseOutputs: {
            intake: {
              featureName: 'test',
              architectureDocs: {},
              dependencies: {},
              removedFiles: [],
            } as AssembledContext,
          },
          worktreePath: '/tmp/test',
        },
        '/tmp/test',
      )

      const result = await agent.execute(context)

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('Missing validation phase output')
    })

    it('should fail when validation was not approved', async () => {
      const { agent } = createAgentWithMockBackend()
      const context = createMockContext(
        {
          phaseOutputs: {
            intake: {
              featureName: 'test',
              architectureDocs: {},
              dependencies: {},
              removedFiles: [],
            } as AssembledContext,
            validation: {
              approved: false,
              issues: [{ type: 'api-contract', severity: 'error', description: 'Missing API' }],
              suggestedFixes: [],
            } as ValidationReport,
          },
          worktreePath: '/tmp/test',
        },
        '/tmp/test',
      )

      const result = await agent.execute(context)

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('Spec validation failed')
    })

    it('should fail when architecture context is missing', async () => {
      const { agent } = createAgentWithMockBackend()
      const context = createMockContext(
        {
          architecture: undefined,
          worktreePath: '/tmp/test',
        },
        '/tmp/test',
      )

      const result = await agent.execute(context)

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('Missing architecture context')
    })

    it('should fail when worktree path is missing', async () => {
      const { agent } = createAgentWithMockBackend()
      const context = createMockContext({}, undefined)

      const result = await agent.execute(context)

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('Missing worktree path')
    })
  })

  describe('Backend Delegation', () => {
    it('should successfully delegate to mock backend', async () => {
      const { agent } = createAgentWithMockBackend()
      const context = createMockContext({}, '/tmp/test')

      const result = await agent.execute(context)

      expect(result.success).toBe(true)
      expect(result.output).toBeDefined()
      const implResult = result.output as ImplementationResult
      expect(implResult.backend).toBe('mock-backend')
      expect(implResult.duration).toBeGreaterThanOrEqual(0)
      expect(Array.isArray(implResult.modifiedFiles)).toBe(true)
      expect(Array.isArray(implResult.addedTests)).toBe(true)
    })

    it('should include backend-provided modified files in result', async () => {
      const { agent } = createAgentWithMockBackend()
      const context = createMockContext({}, '/tmp/test')

      // The mock backend returns ['src/example.ts'] as modified file
      const result = await agent.execute(context)

      expect(result.success).toBe(true)
      const implResult = result.output as ImplementationResult
      expect(implResult.modifiedFiles).toContain('src/example.ts')
      expect(implResult.addedTests).toContain('tests/example.test.ts')
    })

    it('should track tokens used from backend response', async () => {
      const { agent } = createAgentWithMockBackend()
      const context = createMockContext({}, '/tmp/test')

      const result = await agent.execute(context)

      expect(result.success).toBe(true)
      // Mock backend returns 1000 tokens
      expect(result.tokensUsed).toBe(1000)
    })

    it('should emit progress events during execution', async () => {
      const eventBus = new EventBus()
      const progressEvents: string[] = []

      eventBus.on('agent:progress', (event) => {
        if (event.agent === 'executor') {
          progressEvents.push(event.data?.message as string)
        }
      })

      const { agent } = createAgentWithMockBackend(eventBus)
      const context = createMockContext({}, '/tmp/test')

      await agent.execute(context)

      expect(progressEvents.length).toBeGreaterThan(0)
      expect(progressEvents.some((m) => m.includes('Starting implementation attempt'))).toBe(true)
      expect(progressEvents.some((m) => m.includes('Delegating to backend'))).toBe(true)
    })
  })

  describe('Self-Correction', () => {
    it('should succeed on first try when backend succeeds', async () => {
      const { agent } = createAgentWithMockBackend()
      const context = createMockContext({}, '/tmp/test')

      const result = await agent.execute(context)

      expect(result.success).toBe(true)
      const implResult = result.output as ImplementationResult
      expect(implResult.selfCorrectionAttempts).toBe(0) // Success on first try
    })

    it('should return error after exhausting all retries', async () => {
      // Create a failing mock backend
      const failingBackend = new MockBackend('failing-backend', false)
      const config = createMockContext().config
      const registry = new BackendRegistry(config)
      registry.registerBackend('mock-backend', failingBackend)
      const agent = createExecutorAgent(undefined, registry)

      const context = createMockContext({}, '/tmp/test')

      const result = await agent.execute(context)

      expect(result.success).toBe(false)
      // After 4 failed attempts (1 initial + 3 retries), should report failure
      // The mock backend throws "Mock backend 'failing-backend' is not available"
      expect(result.error?.message).toContain('not available')
    })
  })

  describe('Abort Signal Support', () => {
    it('should respect abort signal before execution', async () => {
      const { agent } = createAgentWithMockBackend()
      const abortController = new AbortController()
      abortController.abort()

      const context = createMockContext(
        {
          abortSignal: abortController.signal,
          worktreePath: '/tmp/test',
        },
        '/tmp/test',
      )

      const result = await agent.execute(context)

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('Execution aborted')
    })
  })

  describe('Backend Selection', () => {
    it('should use preferred backend when specified', async () => {
      // Create agent with multiple backends
      const mockBackend1 = new MockBackend('backend-1', true)
      const mockBackend2 = new MockBackend('backend-2', true)
      const config = createMockContext().config
      const registry = new BackendRegistry(config)
      registry.registerBackend('backend-1', mockBackend1)
      registry.registerBackend('backend-2', mockBackend2)
      const agent = createExecutorAgent(undefined, registry)

      const context = createMockContext(
        {
          preferredBackend: 'backend-2',
          worktreePath: '/tmp/test',
        },
        '/tmp/test',
      )

      const result = await agent.execute(context)

      // Should succeed with backend-2 (preferred)
      expect(result.success).toBe(true)
      const implResult = result.output as ImplementationResult
      expect(implResult.backend).toBe('backend-2')
    })
  })

  describe('Error Handling', () => {
    it('should mark validation errors as non-retryable', async () => {
      const { agent } = createAgentWithMockBackend()
      const context = createMockContext(
        {
          phaseOutputs: {
            intake: {
              featureName: 'test',
              architectureDocs: {},
              dependencies: {},
              removedFiles: [],
            } as AssembledContext,
            validation: {
              approved: false,
              issues: [],
              suggestedFixes: [],
            } as ValidationReport,
          },
          worktreePath: '/tmp/test',
        },
        '/tmp/test',
      )

      const result = await agent.execute(context)

      expect(result.success).toBe(false)
      expect(result.error?.retryable).toBe(false)
    })
  })
})
