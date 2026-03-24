/**
 * Core interface that all agents must implement
 * Defines the contract for agent execution in the KASO system
 */

import type { AgentContext, AgentResult, PhaseName } from '@/core/types'

/**
 * Core interface that all agents must implement
 */
export interface Agent {
  /**
   * Execute the agent's logic with the provided context
   * @param context - The agent context containing all necessary data
   * @returns A promise resolving to the agent execution result
   */
  execute(context: AgentContext): Promise<AgentResult>

  /**
   * Check if this agent supports rollback of its changes
   * @returns true if rollback is supported, false otherwise
   */
  supportsRollback(): boolean

  /**
   * Get the estimated duration for this agent to complete
   * @returns Estimated execution time in milliseconds
   */
  estimatedDuration(): number

  /**
   * Get the list of required context keys this agent needs
   * @returns Array of required context key names
   */
  requiredContext(): string[]
}

/**
 * Agent metadata for registry
 */
export interface AgentMetadata {
  phase: PhaseName
  agent: Agent
  name: string
  description?: string
}

/**
 * Interface for agent registry operations
 */
export interface AgentRegistry {
  /**
   * Register an agent for a specific phase
   * @param phase - The phase name this agent handles
   * @param agent - The agent instance to register
   * @param name - Human-readable name for the agent
   * @param description - Optional description of what the agent does
   * @throws Error if agent doesn't implement required interface methods
   */
  register(
    phase: PhaseName,
    agent: Agent,
    name: string,
    description?: string,
  ): void

  /**
   * Get the agent registered for a specific phase
   * @param phase - The phase name to look up
   * @returns The agent registered for this phase, or undefined if not found
   */
  getAgentForPhase(phase: PhaseName): Agent | undefined

  /**
   * List all registered agents
   * @returns Array of all agent metadata
   */
  listRegistered(): AgentMetadata[]
}

// ============================================================================
// Factory Function
// ============================================================================

import { EventBus } from '@/core/event-bus'
import { BackendRegistry } from '@/backends/backend-registry'
import type { KASOConfig } from '@/config/schema'
import { SpecReaderAgent } from './spec-reader'
import { SpecValidatorAgent } from './spec-validator'
import { ArchitectureGuardianAgent } from './architecture-guardian'
import { ExecutorAgent } from './executor'
import { TestEngineerAgent } from './test-engineer'
import { UIValidatorAgent } from './ui-validator'
import { ReviewCouncilAgent } from './review-council'

/** Shared dependencies for agent creation */
export interface AgentDependencies {
  eventBus: EventBus
  backendRegistry: BackendRegistry
}

/**
 * Create an agent instance for a given phase.
 * When `deps` is provided the shared application-level EventBus and
 * BackendRegistry are injected so all agents participate in the same
 * event stream. Without `deps` each agent gets its own isolated instances
 * (useful for unit tests).
 */
export function createAgent(
  phase: PhaseName,
  config: KASOConfig,
  deps?: AgentDependencies,
): Agent {
  const eventBus = deps?.eventBus ?? new EventBus()
  const backendRegistry = deps?.backendRegistry ?? new BackendRegistry(config)

  switch (phase) {
    case 'intake':
      return new SpecReaderAgent('.')
    case 'validation':
      return new SpecValidatorAgent()
    case 'architecture-analysis':
      return new ArchitectureGuardianAgent('architecture-analysis')
    case 'architecture-review':
      return new ArchitectureGuardianAgent('architecture-review')
    case 'implementation':
      return new ExecutorAgent(eventBus, backendRegistry)
    case 'test-verification':
      return new TestEngineerAgent(eventBus)
    case 'ui-validation':
      return new UIValidatorAgent({ eventBus })
    case 'review-delivery':
      return new ReviewCouncilAgent({
        eventBus,
        backendResolver: () => undefined,
      })
    default:
      if (phase.startsWith('custom-')) {
        throw new Error(
          `Custom phase agents must be loaded via plugin system: ${phase}`,
        )
      }
      throw new Error(`Unknown phase: ${phase}`)
  }
}
