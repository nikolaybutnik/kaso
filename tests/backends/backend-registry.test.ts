/**
 * Unit tests for backend registry
 */

import { describe, it, expect } from 'vitest'
import { BackendRegistry } from '@/backends/backend-registry'
import type { KASOConfig } from '@/config/schema'
import type { AgentContext } from '@/core/types'

/**
 * Creates a test configuration with multiple backends
 */
function createTestConfig(): KASOConfig {
  return {
    phaseBackends: {},
    executorBackends: [
      {
        name: 'kimi-code',
        command: 'kimi',
        args: [],
        protocol: 'cli-json',
        maxContextWindow: 128000,
        costPer1000Tokens: 0.01,
        enabled: true,
      },
      {
        name: 'claude-code',
        command: 'claude',
        args: [],
        protocol: 'cli-json',
        maxContextWindow: 200000,
        costPer1000Tokens: 0.03,
        enabled: true,
      },
      {
        name: 'cheap-model',
        command: 'cheap',
        args: [],
        protocol: 'cli-stdout',
        maxContextWindow: 64000,
        costPer1000Tokens: 0.005,
        enabled: true,
      },
      {
        name: 'disabled-backend',
        command: 'disabled',
        args: [],
        protocol: 'cli-stdout',
        maxContextWindow: 64000,
        costPer1000Tokens: 0.01,
        enabled: false,
      },
    ],
    defaultBackend: 'kimi-code',
    backendSelectionStrategy: 'default',
    maxConcurrentAgents: 'auto',
    maxPhaseRetries: 2,
    defaultPhaseTimeout: 300,
    phaseTimeouts: {},
    contextCapping: {
      enabled: true,
      charsPerToken: 4,
      relevanceRanking: [],
    },
    reviewCouncil: {
      maxReviewRounds: 2,
      enableParallelReview: false,
      perspectives: ['security', 'performance', 'maintainability'],
    },
    uiBaseline: {
      baselineDir: '.kiro/ui-baselines',
      captureOnPass: true,
      diffThreshold: 0.1,
      viewport: {
        width: 1280,
        height: 720,
      },
    },
    webhooks: [],
    mcpServers: [],
    plugins: [],
    customPhases: [],
    executionStore: {
      type: 'sqlite',
      path: '.kaso-execution-store.db',
    },
  }
}

describe('BackendRegistry', () => {
  it('should register all enabled backends from config', () => {
    const config = createTestConfig()
    const registry = new BackendRegistry(config)

    const backends = registry.listBackends()
    expect(backends).toContain('kimi-code')
    expect(backends).toContain('claude-code')
    expect(backends).toContain('cheap-model')
    expect(backends).not.toContain('disabled-backend')
  })

  it('should throw error if default backend is not registered', () => {
    const config = createTestConfig()
    config.defaultBackend = 'non-existent'

    expect(() => new BackendRegistry(config)).toThrow(
      "Default backend 'non-existent' is not registered",
    )
  })

  it('should throw error if default backend is disabled', () => {
    const config = createTestConfig()
    config.defaultBackend = 'disabled-backend'

    expect(() => new BackendRegistry(config)).toThrow(
      "Default backend 'disabled-backend' is not registered",
    )
  })

  it('should get backend by name', () => {
    const config = createTestConfig()
    const registry = new BackendRegistry(config)

    const backend = registry.getBackend('kimi-code')
    expect(backend.name).toBe('kimi-code')
  })

  it('should throw error when getting non-existent backend', () => {
    const config = createTestConfig()
    const registry = new BackendRegistry(config)

    expect(() => registry.getBackend('non-existent')).toThrow(
      "Backend 'non-existent' not found",
    )
  })

  it('should return default backend with default strategy', () => {
    const config = createTestConfig()
    const registry = new BackendRegistry(config)

    const context: AgentContext = {
      runId: 'test-run',
      spec: {
        featureName: 'test',
        specPath: '/test/spec',
        missingFiles: [],
      },
      steering: { hooks: {} },
      phaseOutputs: {},
      config,
      backends: {},
    }

    const backend = registry.selectBackend(context)
    expect(backend.name).toBe('kimi-code')
  })

  it('should select cheapest fitting backend with context-aware strategy', () => {
    const config = createTestConfig()
    config.backendSelectionStrategy = 'context-aware'
    const registry = new BackendRegistry(config)

    // Create context with size that fits in cheap-model (64000 tokens) but exceeds it slightly
    // This will be ~68000 tokens = 272000 chars
    const context: AgentContext = {
      runId: 'test-run',
      spec: {
        featureName: 'test',
        specPath: '/test/spec',
        missingFiles: [],
        design: {
          rawContent: 'x'.repeat(272000), // ~68000 tokens (exceeds cheap-model's 64000)
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
      },
      steering: { hooks: {} },
      phaseOutputs: {},
      config,
      backends: {},
    }

    const backend = registry.selectBackend(context)
    // Should select kimi-code (cheapest that fits, cheaper than claude-code)
    expect(backend.name).toBe('kimi-code')
  })

  it('should throw error when no backend fits context size', () => {
    const config = createTestConfig()
    config.backendSelectionStrategy = 'context-aware'
    const registry = new BackendRegistry(config)

    // Create context that's too large for all backends (larger than 200000 tokens)
    const context: AgentContext = {
      runId: 'test-run',
      spec: {
        featureName: 'test',
        specPath: '/test/spec',
        missingFiles: [],
        design: {
          rawContent: 'x'.repeat(900000), // ~900000 chars = ~225000 tokens (exceeds all backends)
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
      },
      steering: { hooks: {} },
      phaseOutputs: {},
      config,
      backends: {},
    }

    expect(() => registry.selectBackend(context)).toThrow(
      'No backend available for context size',
    )
  })

  it('should return backend configuration', () => {
    const config = createTestConfig()
    const registry = new BackendRegistry(config)

    const backendConfig = registry.getConfig('kimi-code')
    expect(backendConfig).toBeDefined()
    expect(backendConfig?.name).toBe('kimi-code')
    expect(backendConfig?.costPer1000Tokens).toBe(0.01)
  })

  it('should return undefined for non-existent backend config', () => {
    const config = createTestConfig()
    const registry = new BackendRegistry(config)

    const backendConfig = registry.getConfig('non-existent')
    expect(backendConfig).toBeUndefined()
  })

  it('should return default backend name', () => {
    const config = createTestConfig()
    const registry = new BackendRegistry(config)

    expect(registry.getDefaultBackendName()).toBe('kimi-code')
  })

  it('should return selection strategy', () => {
    const config = createTestConfig()
    const registry = new BackendRegistry(config)

    expect(registry.getSelectionStrategy()).toBe('default')
  })
})
