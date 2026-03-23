import { Agent, AgentMetadata, AgentRegistry } from './agent-interface'
import { PhaseName } from '@/core/types'

/**
 * Implementation of AgentRegistry with validation at registration time
 */
export class AgentRegistryImpl implements AgentRegistry {
  private agents = new Map<PhaseName, AgentMetadata>()

  /**
   * Register an agent for a specific phase
   * Validates all required interface methods before accepting registration
   */
  register(
    phase: PhaseName,
    agent: Agent,
    name: string,
    description?: string,
  ): void {
    // Validate agent implements required interface methods
    const errors = this.validateAgentInterface(agent)

    if (errors.length > 0) {
      throw new Error(
        `Agent '${name}' does not implement required interface: ${errors.join(', ')}`,
      )
    }

    // Check if agent already registered for this phase
    if (this.agents.has(phase)) {
      const existing = this.agents.get(phase)!
      console.warn(
        `Overriding agent for phase '${phase}': ${existing.name} → ${name}`,
      )
    }

    // Register the agent
    this.agents.set(phase, {
      phase,
      agent,
      name,
      description,
    })

    console.log(`Registered agent '${name}' for phase '${phase}'`)
  }

  /**
   * Get the agent registered for a specific phase
   */
  getAgentForPhase(phase: PhaseName): Agent | undefined {
    return this.agents.get(phase)?.agent
  }

  /**
   * List all registered agents
   */
  listRegistered(): AgentMetadata[] {
    return Array.from(this.agents.values())
  }

  /**
   * Validate that an agent implements all required interface methods
   */
  private validateAgentInterface(agent: Agent): string[] {
    const errors: string[] = []

    // Check execute method
    if (typeof agent.execute !== 'function') {
      errors.push('missing execute() method')
    }

    // Check supportsRollback method
    if (typeof agent.supportsRollback !== 'function') {
      errors.push('missing supportsRollback() method')
    } else {
      try {
        const result = agent.supportsRollback()
        if (typeof result !== 'boolean') {
          errors.push('supportsRollback() must return boolean')
        }
      } catch {
        errors.push('supportsRollback() failed to execute')
      }
    }

    // Check estimatedDuration method
    if (typeof agent.estimatedDuration !== 'function') {
      errors.push('missing estimatedDuration() method')
    } else {
      try {
        const result = agent.estimatedDuration()
        if (typeof result !== 'number' || result < 0) {
          errors.push('estimatedDuration() must return non-negative number')
        }
      } catch {
        errors.push('estimatedDuration() failed to execute')
      }
    }

    // Check requiredContext method
    if (typeof agent.requiredContext !== 'function') {
      errors.push('missing requiredContext() method')
    } else {
      try {
        const result = agent.requiredContext()
        if (!Array.isArray(result)) {
          errors.push('requiredContext() must return array of strings')
        } else if (!result.every((item) => typeof item === 'string')) {
          errors.push('requiredContext() must return array of strings')
        }
      } catch {
        errors.push('requiredContext() failed to execute')
      }
    }

    return errors
  }

  /**
   * Get the number of registered agents
   */
  getAgentCount(): number {
    return this.agents.size
  }

  /**
   * Unregister an agent for a specific phase
   */
  unregister(phase: PhaseName): boolean {
    return this.agents.delete(phase)
  }

  /**
   * Check if an agent is registered for a phase
   */
  hasAgentForPhase(phase: PhaseName): boolean {
    return this.agents.has(phase)
  }

  /**
   * Get metadata for a specific phase
   */
  getAgentMetadata(phase: PhaseName): AgentMetadata | undefined {
    return this.agents.get(phase)
  }
}
