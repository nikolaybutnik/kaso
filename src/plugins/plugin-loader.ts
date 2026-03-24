/**
 * Plugin Loader for KASO
 *
 * Discovers and loads custom agents from npm packages listed in config.
 * Validates each plugin implements the Agent interface before registration.
 *
 * Security Note: Plugins run with the same privileges as the host process
 * — there is no sandboxing. Only install plugins from trusted sources.
 *
 * Requirements: 22.1, 22.2, 22.3
 */

import type { Agent, AgentRegistry } from '@/agents/agent-interface'
import type { PluginConfig } from '@/config/schema'
import { PhaseName } from '@/core/types'

/**
 * Result of loading a plugin
 */
export interface PluginLoadResult {
  package: string
  success: boolean
  agent?: Agent
  phaseName?: PhaseName
  error?: string
}

/**
 * Plugin metadata extracted from package
 */
export interface PluginMetadata {
  name: string
  version: string
  description?: string
  kaso?: {
    phase?: string
    agent?: string
  }
}

/**
 * Validates that an object implements the Agent interface
 */
export function validateAgentInterface(obj: unknown): {
  valid: boolean
  errors: string[]
} {
  const errors: string[] = []

  if (obj === null || typeof obj !== 'object') {
    return { valid: false, errors: ['Plugin export is not an object'] }
  }

  const agent = obj as Record<string, unknown>

  // Check required methods
  const requiredMethods = [
    'execute',
    'supportsRollback',
    'estimatedDuration',
    'requiredContext',
  ]

  for (const method of requiredMethods) {
    if (!(method in agent)) {
      errors.push(`Missing required method: ${method}`)
    } else if (typeof agent[method] !== 'function') {
      errors.push(`${method} is not a function`)
    }
  }

  return { valid: errors.length === 0, errors }
}

/**
 * Load a plugin from an npm package
 */
export async function loadPlugin(
  config: PluginConfig,
): Promise<PluginLoadResult> {
  const { package: packageName, enabled } = config

  if (!enabled) {
    return {
      package: packageName,
      success: false,
      error: 'Plugin is disabled',
    }
  }

  try {
    // Dynamic import of the plugin package
    const pluginModule = (await import(packageName)) as Record<string, unknown>

    // Get the default export or named export
    const AgentClass =
      pluginModule.default ?? pluginModule.KasoAgent ?? pluginModule.agent

    if (!AgentClass) {
      return {
        package: packageName,
        success: false,
        error: `No agent export found in package '${packageName}'. Expected default export or named export 'KasoAgent' or 'agent'`,
      }
    }

    // Instantiate the agent
    let agent: Agent
    try {
      const Constructor = AgentClass as new (
        config?: Record<string, unknown>,
      ) => Agent
      agent = new Constructor(config.config)
    } catch (error) {
      return {
        package: packageName,
        success: false,
        error: `Failed to instantiate agent: ${errorMessage(error)}`,
      }
    }

    // Validate the agent interface
    const validation = validateAgentInterface(agent)
    if (!validation.valid) {
      return {
        package: packageName,
        success: false,
        error: `Agent does not implement required interface: ${validation.errors.join(', ')}`,
      }
    }

    // Extract phase name from plugin metadata or config
    const phaseName =
      (config.config?.phase as PhaseName) ??
      extractPhaseFromPackage(packageName)

    return {
      package: packageName,
      success: true,
      agent,
      phaseName,
    }
  } catch (error) {
    return {
      package: packageName,
      success: false,
      error: `Failed to load package: ${errorMessage(error)}`,
    }
  }
}

/**
 * Extract a phase name from a package name
 * Converts package name like "kaso-custom-linter" to "custom-linter"
 */
function extractPhaseFromPackage(packageName: string): PhaseName {
  // Remove common prefixes
  const withoutPrefix = packageName
    .replace(/^kaso-/, '')
    .replace(/^@kaso\//, '')
    .replace(/^kaso-plugin-/, '')

  // Convert to valid phase name format
  const phaseName = `custom-${withoutPrefix.replace(/[^a-z0-9-]/g, '-')}`
  return phaseName as PhaseName
}

/**
 * Load all configured plugins
 */
export async function loadAllPlugins(
  configs: PluginConfig[],
): Promise<PluginLoadResult[]> {
  const results: PluginLoadResult[] = []

  for (const config of configs) {
    const result = await loadPlugin(config)
    results.push(result)
  }

  return results
}

/**
 * Plugin Loader class for managing plugin lifecycle
 */
export class PluginLoader {
  private results: PluginLoadResult[] = []

  constructor(
    private agentRegistry: AgentRegistry,
    private configs: PluginConfig[],
  ) {}

  /**
   * Load and register all configured plugins
   */
  async loadAndRegister(): Promise<PluginLoadResult[]> {
    this.results = await loadAllPlugins(this.configs)

    for (const result of this.results) {
      if (result.success && result.agent && result.phaseName) {
        this.agentRegistry.register(
          result.phaseName,
          result.agent,
          result.package,
          `Plugin from ${result.package}`,
        )
      }
    }

    return this.results
  }

  /**
   * Get all load results
   */
  getResults(): PluginLoadResult[] {
    return [...this.results]
  }

  /**
   * Get successful loads
   */
  getSuccessfulLoads(): PluginLoadResult[] {
    return this.results.filter((r) => r.success)
  }

  /**
   * Get failed loads
   */
  getFailedLoads(): PluginLoadResult[] {
    return this.results.filter((r) => !r.success)
  }

  /**
   * Check if all plugins loaded successfully
   */
  allSuccessful(): boolean {
    return this.results.every((r) => r.success)
  }
}

/**
 * Create a plugin loader instance
 */
export function createPluginLoader(
  agentRegistry: AgentRegistry,
  configs: PluginConfig[],
): PluginLoader {
  return new PluginLoader(agentRegistry, configs)
}

/**
 * Extract error message from unknown error
 */
function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
