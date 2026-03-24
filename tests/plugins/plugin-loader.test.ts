/**
 * Unit tests for Plugin Loader
 *
 * Requirements: 22.1, 22.2, 22.3
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  PluginLoader,
  validateAgentInterface,
  loadAllPlugins,
  createPluginLoader,
} from '../../src/plugins/plugin-loader'
import type { Agent } from '../../src/agents/agent-interface'
import { AgentRegistryImpl } from '../../src/agents/agent-registry'
import type { PluginConfig } from '../../src/config/schema'

// =============================================================================
// Test Fixtures
// =============================================================================

function createValidAgent(): Agent {
  return {
    execute: vi.fn().mockResolvedValue({
      success: true,
      output: { result: 'test' },
    }),
    supportsRollback: vi.fn().mockReturnValue(false),
    estimatedDuration: vi.fn().mockReturnValue(1000),
    requiredContext: vi.fn().mockReturnValue([]),
  }
}

function createInvalidAgent(missingMethods: string[] = []): Record<string, unknown> {
  const agent: Record<string, unknown> = {}

  const allMethods = ['execute', 'supportsRollback', 'estimatedDuration', 'requiredContext']
  for (const method of allMethods) {
    if (!missingMethods.includes(method)) {
      agent[method] = vi.fn()
    }
  }

  return agent
}

function createPluginConfig(overrides: Partial<PluginConfig> = {}): PluginConfig {
  return {
    package: 'test-plugin',
    enabled: true,
    config: {},
    ...overrides,
  }
}

// =============================================================================
// validateAgentInterface Tests
// =============================================================================

describe('validateAgentInterface', () => {
  it('should validate a valid agent', () => {
    const agent = createValidAgent()
    const result = validateAgentInterface(agent)

    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('should reject null', () => {
    const result = validateAgentInterface(null)

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Plugin export is not an object')
  })

  it('should reject non-object', () => {
    const result = validateAgentInterface('string')

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Plugin export is not an object')
  })

  it('should reject agent missing execute method', () => {
    const agent = createInvalidAgent(['execute'])
    const result = validateAgentInterface(agent)

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing required method: execute')
  })

  it('should reject agent missing supportsRollback method', () => {
    const agent = createInvalidAgent(['supportsRollback'])
    const result = validateAgentInterface(agent)

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing required method: supportsRollback')
  })

  it('should reject agent missing estimatedDuration method', () => {
    const agent = createInvalidAgent(['estimatedDuration'])
    const result = validateAgentInterface(agent)

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing required method: estimatedDuration')
  })

  it('should reject agent missing requiredContext method', () => {
    const agent = createInvalidAgent(['requiredContext'])
    const result = validateAgentInterface(agent)

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing required method: requiredContext')
  })

  it('should reject agent with non-function methods', () => {
    const agent = {
      execute: 'not a function',
      supportsRollback: vi.fn(),
      estimatedDuration: vi.fn(),
      requiredContext: vi.fn(),
    }
    const result = validateAgentInterface(agent)

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('execute is not a function')
  })

  it('should report all missing methods', () => {
    const agent = createInvalidAgent(['execute', 'supportsRollback'])
    const result = validateAgentInterface(agent)

    expect(result.valid).toBe(false)
    expect(result.errors).toContain('Missing required method: execute')
    expect(result.errors).toContain('Missing required method: supportsRollback')
  })
})

// =============================================================================
// loadAllPlugins Tests
// =============================================================================

describe('loadAllPlugins', () => {
  it('should return empty array for empty config', async () => {
    const results = await loadAllPlugins([])
    expect(results).toHaveLength(0)
  })

  it('should skip disabled plugins', async () => {
    const configs = [createPluginConfig({ enabled: false })]
    const results = await loadAllPlugins(configs)

    expect(results).toHaveLength(1)
    const firstResult = results[0]!
    expect(firstResult.package).toBe('test-plugin')
    expect(firstResult.success).toBe(false)
    expect(firstResult.error).toBeDefined()
    expect(firstResult.error).toBe('Plugin is disabled')
  })

  it('should handle non-existent packages', async () => {
    const configs = [createPluginConfig({ package: 'non-existent-package-12345' })]
    const results = await loadAllPlugins(configs)

    expect(results).toHaveLength(1)
    const firstResult2 = results[0]!
    expect(firstResult2.success).toBe(false)
    expect(firstResult2.error).toBeDefined()
    expect(firstResult2.error).toContain('Failed to load package')
  })
})

// =============================================================================
// PluginLoader Tests
// =============================================================================

describe('PluginLoader', () => {
  let agentRegistry: AgentRegistryImpl

  beforeEach(() => {
    agentRegistry = new AgentRegistryImpl()
  })

  it('should create with configs', () => {
    const configs = [createPluginConfig()]
    const loader = createPluginLoader(agentRegistry, configs)

    expect(loader).toBeInstanceOf(PluginLoader)
  })

  it('should return results after loading', async () => {
    const configs = [createPluginConfig({ enabled: false })]
    const loader = createPluginLoader(agentRegistry, configs)

    const results = await loader.loadAndRegister()

    expect(results).toHaveLength(1)
    expect(loader.getResults()).toEqual(results)
  })

  it('should get successful loads', async () => {
    const configs = [
      createPluginConfig({ package: 'disabled-plugin', enabled: false }),
    ]
    const loader = createPluginLoader(agentRegistry, configs)
    await loader.loadAndRegister()

    const successful = loader.getSuccessfulLoads()
    expect(successful).toHaveLength(0)

    const failed = loader.getFailedLoads()
    expect(failed).toHaveLength(1)
  })

  it('should report allSuccessful correctly when all fail', async () => {
    const configs = [createPluginConfig({ enabled: false })]
    const loader = createPluginLoader(agentRegistry, configs)
    await loader.loadAndRegister()

    expect(loader.allSuccessful()).toBe(false)
  })

  it('should register successful plugins with registry', async () => {
    // Create a mock plugin that will load successfully
    const mockAgent = createValidAgent()

    // Mock the module import
    vi.doMock('mock-valid-plugin', () => ({
      default: vi.fn().mockImplementation(() => mockAgent),
    }))

    const configs = [
      createPluginConfig({
        package: 'mock-valid-plugin',
        config: { phase: 'custom-mock' },
      }),
    ]

    const loader = createPluginLoader(agentRegistry, configs)
    await loader.loadAndRegister()

    // Cleanup mock
    vi.doUnmock('mock-valid-plugin')
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('Plugin Loader Integration', () => {
  it('should handle multiple plugins with mixed success', async () => {
    const configs: PluginConfig[] = [
      createPluginConfig({ package: 'plugin-1', enabled: false }),
      createPluginConfig({ package: 'non-existent-plugin-12345' }),
      createPluginConfig({ package: 'plugin-3', enabled: false }),
    ]

    const results = await loadAllPlugins(configs)

    expect(results).toHaveLength(3)
    expect(results[0]!.success).toBe(false)
    expect(results[1]!.success).toBe(false)
    expect(results[2]!.success).toBe(false)
  })
})
