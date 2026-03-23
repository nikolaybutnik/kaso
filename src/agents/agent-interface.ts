import { AgentContext, AgentResult, PhaseName } from '@/core/types'

/**
 * Core interface that all agents must implement
 * Defines the contract for agent execution in the KASO system
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
