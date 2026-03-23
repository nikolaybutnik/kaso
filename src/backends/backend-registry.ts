/**
 * Backend registry for managing executor backends
 * Handles backend registration, selection, and lifecycle
 */

import type { ExecutorBackend } from './backend-adapter'
import type { ExecutorBackendConfig, KASOConfig } from '../config/schema'
import type { AgentContext } from '../core/types'
import { CLIProcessBackend } from './backend-process'

/**
 * Backend registry class
 * Manages multiple executor backends and provides selection strategies
 */
export class BackendRegistry {
  private backends = new Map<string, ExecutorBackend>()
  private configs = new Map<string, ExecutorBackendConfig>()
  private defaultBackendName: string
  private selectionStrategy: 'default' | 'context-aware'

  /**
   * Create a new backend registry
   * @param config - KASO configuration containing backend definitions
   */
  constructor(config: KASOConfig) {
    this.defaultBackendName = config.defaultBackend
    this.selectionStrategy = config.backendSelectionStrategy

    // Register all configured backends
    for (const backendConfig of config.executorBackends) {
      if (backendConfig.enabled) {
        this.register(backendConfig)
      }
    }

    // Validate default backend exists
    if (!this.backends.has(this.defaultBackendName)) {
      throw new Error(
        `Default backend '${this.defaultBackendName}' is not registered or is disabled. ` +
          `Available backends: ${Array.from(this.backends.keys()).join(', ')}`,
      )
    }
  }

  /**
   * Register a backend configuration
   * @param config - Backend configuration
   */
  private register(config: ExecutorBackendConfig): void {
    const backend = new CLIProcessBackend(config)
    this.backends.set(config.name, backend)
    this.configs.set(config.name, config)
  }

  /**
   * Get a backend by name
   * @param name - Backend name
   * @returns The backend instance
   * @throws Error if backend not found
   */
  getBackend(name: string): ExecutorBackend {
    const backend = this.backends.get(name)
    if (!backend) {
      throw new Error(
        `Backend '${name}' not found. Available backends: ${Array.from(
          this.backends.keys(),
        ).join(', ')}`,
      )
    }
    return backend
  }

  /**
   * Select the appropriate backend based on strategy
   * @param context - Agent context for context-aware selection
   * @returns Selected backend instance
   */
  selectBackend(context?: AgentContext): ExecutorBackend {
    if (this.selectionStrategy === 'context-aware' && context) {
      return this.selectContextAwareBackend(context)
    }
    return this.getBackend(this.defaultBackendName)
  }

  /**
   * Select backend using context-aware strategy
   * Chooses the cheapest backend that can handle the context size
   * @param context - Agent context
   * @returns Selected backend instance
   */
  private selectContextAwareBackend(context: AgentContext): ExecutorBackend {
    // Estimate context size in tokens (rough estimation)
    const contextSize = this.estimateContextSize(context)

    // Get all available backends sorted by cost
    const availableBackends = Array.from(this.configs.entries())
      .filter(([_, config]) => config.enabled)
      .filter(([_, config]) => contextSize <= config.maxContextWindow)
      .sort(([, a], [, b]) => a.costPer1000Tokens - b.costPer1000Tokens)

    if (availableBackends.length === 0) {
      throw new Error(
        `No backend available for context size ${contextSize} tokens. ` +
          `Consider reducing context size or configuring a backend with larger maxContextWindow.`,
      )
    }

    // Return the cheapest available backend (guaranteed by length check above)
    const cheapest = availableBackends[0]
    if (!cheapest) {
      throw new Error('Unexpected: no backends available after filtering')
    }
    return this.getBackend(cheapest[0])
  }

  /**
   * Estimate context size in tokens
   * @param context - Agent context
   * @returns Estimated token count
   */
  private estimateContextSize(context: AgentContext): number {
    // Rough estimation: 1 token ≈ 4 characters
    const charsPerToken = context.config.contextCapping.charsPerToken || 4

    let charCount = 0

    // Count spec content
    if (context.spec.design?.rawContent) {
      charCount += context.spec.design.rawContent.length
    }
    if (context.spec.techSpec?.rawContent) {
      charCount += context.spec.techSpec.rawContent.length
    }

    // Count task list items
    if (context.spec.taskList) {
      charCount += JSON.stringify(context.spec.taskList).length
    }

    // Count architecture docs
    if (context.architecture?.adrs) {
      for (const adr of Object.values(context.architecture.adrs)) {
        charCount += adr.rawContent?.length || 0
      }
    }

    // Count steering files
    if (context.steering.codingPractices) {
      charCount += context.steering.codingPractices.length
    }
    if (context.steering.personality) {
      charCount += context.steering.personality.length
    }

    // Count missing files list
    if (context.spec.missingFiles.length > 0) {
      charCount += JSON.stringify(context.spec.missingFiles).length
    }

    // Count phase outputs (rough estimate)
    for (const output of Object.values(context.phaseOutputs)) {
      if (output) {
        charCount += JSON.stringify(output).length
      }
    }

    return Math.ceil(charCount / charsPerToken)
  }

  /**
   * List all registered backend names
   * @returns Array of backend names
   */
  listBackends(): string[] {
    return Array.from(this.backends.keys())
  }

  /**
   * Get backend configuration
   * @param name - Backend name
   * @returns Backend configuration or undefined
   */
  getConfig(name: string): ExecutorBackendConfig | undefined {
    return this.configs.get(name)
  }

  /**
   * Check if a backend is available
   * @param name - Backend name
   * @returns Promise resolving to availability status
   */
  async isBackendAvailable(name: string): Promise<boolean> {
    const backend = this.backends.get(name)
    if (!backend) {
      return false
    }
    return backend.isAvailable()
  }

  /**
   * Get the default backend name
   */
  getDefaultBackendName(): string {
    return this.defaultBackendName
  }

  /**
   * Get the selection strategy
   */
  getSelectionStrategy(): 'default' | 'context-aware' {
    return this.selectionStrategy
  }
}
