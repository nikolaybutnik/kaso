/**
 * Error handling and recovery logic for the orchestrator
 * Implements rollback, retry with modified strategies, and escalation
 */

import type { PhaseName, AgentError, PhaseOutput } from './types'
import type { Agent, AgentRegistry } from '@/agents/agent-interface'
import type { BackendRegistry } from '@/backends/backend-registry'
import type { KASOConfig, ExecutorBackendConfig } from '@/config/schema'

/**
 * Result of error handling decision
 */
export interface ErrorHandlerResult {
  action: 'retry' | 'rollback-retry' | 'loopback' | 'escalate' | 'halt'
  reason: string
  modifiedContext?: {
    reducedContext?: boolean
    alternativeBackend?: string
    retryCount: number
  }
}

/**
 * Error classification for determining handling strategy
 */
export type ErrorSeverity = 'transient' | 'recoverable' | 'security' | 'architectural' | 'fatal'

/**
 * Tracks retry state for a phase
 */
export interface RetryState {
  phase: PhaseName
  count: number
  lastStrategy: 'default' | 'reduced-context' | 'alternative-backend'
}

/**
 * Error handler for managing phase failures and recovery strategies
 */
export class ErrorHandler {
  private readonly backendRegistry: BackendRegistry
  private readonly config: KASOConfig
  private readonly retryStates = new Map<string, RetryState>()

  constructor(
    _agentRegistry: AgentRegistry,
    backendRegistry: BackendRegistry,
    config: KASOConfig,
  ) {
    this.backendRegistry = backendRegistry
    this.config = config
  }

  /**
   * Handle a phase failure and determine the recovery action
   * @param runId - The run identifier
   * @param phase - The phase that failed
   * @param error - The error from the phase
   * @param agent - The agent that executed the phase
   * @returns ErrorHandlerResult with the action to take
   */
  handleFailure(
    runId: string,
    phase: PhaseName,
    error: AgentError,
    agent: Agent,
  ): ErrorHandlerResult {
    const severity = this.classifyError(error)
    const state = this.getRetryState(runId, phase)

    // Immediate escalation for security concerns (Req 16.4)
    if (severity === 'security') {
      return {
        action: 'escalate',
        reason: `Security concern detected: ${error.message}`,
        modifiedContext: { retryCount: state.count },
      }
    }

    // Immediate escalation for architectural deadlock (Req 16.4)
    if (severity === 'architectural') {
      return {
        action: 'escalate',
        reason: `Architectural deadlock detected: ${error.message}`,
        modifiedContext: { retryCount: state.count },
      }
    }

    // Check if we've exceeded max retries (3 consecutive failures = 1 initial + 2 additional)
    const maxRetries = this.config.maxPhaseRetries ?? 2
    if (state.count >= maxRetries) {
      return {
        action: 'escalate',
        reason: `Phase '${phase}' failed after ${state.count + 1} consecutive attempts`,
        modifiedContext: { retryCount: state.count },
      }
    }

    // If agent supports rollback, use rollback-retry strategy (Req 16.1)
    if (agent.supportsRollback()) {
      const nextStrategy = this.getNextStrategy(state)
      this.incrementRetryState(runId, phase, nextStrategy)

      return {
        action: 'rollback-retry',
        reason: `Rolling back and retrying phase '${phase}' with modified strategy: ${nextStrategy}`,
        modifiedContext: {
          ...this.buildModifiedContext(nextStrategy),
          retryCount: state.count + 1,
        },
      }
    }

    // Standard retry with modified strategy (Req 16.2)
    const nextStrategy = this.getNextStrategy(state)
    this.incrementRetryState(runId, phase, nextStrategy)

    return {
      action: 'retry',
      reason: `Retrying phase '${phase}' with modified strategy: ${nextStrategy}`,
      modifiedContext: {
        ...this.buildModifiedContext(nextStrategy),
        retryCount: state.count + 1,
      },
    }
  }

  /**
   * Classify an error to determine its severity and handling strategy
   */
  classifyError(error: AgentError): ErrorSeverity {
    const message = error.message.toLowerCase()
    const code = error.code?.toLowerCase() ?? ''

    // Security-related errors
    if (
      message.includes('security') ||
      message.includes('vulnerability') ||
      message.includes('injection') ||
      message.includes('xss') ||
      message.includes('csrf') ||
      code.includes('security')
    ) {
      return 'security'
    }

    // Architectural deadlock errors
    if (
      message.includes('architectural') ||
      message.includes('deadlock') ||
      message.includes('circular dependency') ||
      message.includes('contradiction') ||
      code.includes('architectural')
    ) {
      return 'architectural'
    }

    // Fatal/non-retryable errors
    if (!error.retryable) {
      return 'fatal'
    }

    // Transient errors (network, timeout, etc.)
    if (
      message.includes('timeout') ||
      message.includes('network') ||
      message.includes('temporary') ||
      message.includes('unavailable') ||
      code.includes('transient')
    ) {
      return 'transient'
    }

    return 'recoverable'
  }

  /**
   * Get the appropriate error policy for a phase
   */
  getPhaseErrorPolicy(phase: PhaseName): {
    onFailure: 'halt' | 'loopback' | 'retry'
    maxRetries: number
  } {
    // Phase-specific error policies (Req 16.6)
    const policies: Record<string, { onFailure: 'halt' | 'loopback' | 'retry'; maxRetries: number }> = {
      'intake': { onFailure: 'halt', maxRetries: 1 },
      'validation': { onFailure: 'halt', maxRetries: 1 },
      'architecture-analysis': { onFailure: 'halt', maxRetries: 1 },
      'implementation': { onFailure: 'retry', maxRetries: this.config.maxPhaseRetries ?? 2 },
      'architecture-review': { onFailure: 'loopback', maxRetries: 1 },
      'test-verification': { onFailure: 'loopback', maxRetries: 2 },
      'ui-validation': { onFailure: 'retry', maxRetries: 1 },
      'review-delivery': { onFailure: 'halt', maxRetries: 1 },
    }

    return policies[phase] ?? { onFailure: 'halt', maxRetries: 1 }
  }

  /**
   * Clear retry state for a run
   */
  clearRunState(runId: string): void {
    for (const key of this.retryStates.keys()) {
      if (key.startsWith(`${runId}:`)) {
        this.retryStates.delete(key)
      }
    }
  }

  /**
   * Get the current retry state for a phase
   */
  getRetryState(runId: string, phase: PhaseName): RetryState {
    const key = `${runId}:${phase}`
    return this.retryStates.get(key) ?? { phase, count: 0, lastStrategy: 'default' }
  }

  /**
   * Increment retry count and update strategy
   */
  private incrementRetryState(
    runId: string,
    phase: PhaseName,
    strategy: RetryState['lastStrategy'],
  ): void {
    const key = `${runId}:${phase}`
    const current = this.getRetryState(runId, phase)
    this.retryStates.set(key, {
      phase,
      count: current.count + 1,
      lastStrategy: strategy,
    })
  }

  /**
   * Determine the next retry strategy based on current state
   */
  private getNextStrategy(state: RetryState): RetryState['lastStrategy'] {
    const strategies: RetryState['lastStrategy'][] = ['default', 'reduced-context', 'alternative-backend']
    const currentIndex = strategies.indexOf(state.lastStrategy)
    return strategies[currentIndex + 1] ?? 'alternative-backend'
  }

  /**
   * Build modified context based on retry strategy
   */
  private buildModifiedContext(
    strategy: RetryState['lastStrategy'],
  ): { reducedContext?: boolean; alternativeBackend?: string } {
    switch (strategy) {
      case 'reduced-context':
        return { reducedContext: true }
      case 'alternative-backend': {
        const alternative = this.findAlternativeBackend()
        return alternative ? { alternativeBackend: alternative.name } : {}
      }
      default:
        return {}
    }
  }

  /**
   * Find an alternative backend for retry
   */
  private findAlternativeBackend(): ExecutorBackendConfig | undefined {
    const defaultName = this.backendRegistry.getDefaultBackendName()
    const allBackends = this.backendRegistry.listBackends()

    // Find first enabled backend that's not the default
    for (const name of allBackends) {
      if (name === defaultName) continue
      const config = this.backendRegistry.getConfig(name)
      if (config?.enabled !== false) {
        return config
      }
    }

    return undefined
  }

  /**
   * Build a detailed failure report for escalation
   */
  buildFailureReport(
    runId: string,
    phase: PhaseName,
    error: AgentError,
    phaseOutputs: Partial<Record<PhaseName, PhaseOutput>>,
  ): {
    runId: string
    failedPhase: PhaseName
    error: AgentError
    attempts: number
    severity: ErrorSeverity
    previousOutputs: Partial<Record<PhaseName, PhaseOutput>>
    timestamp: string
  } {
    return {
      runId,
      failedPhase: phase,
      error,
      attempts: this.getRetryState(runId, phase).count + 1,
      severity: this.classifyError(error),
      previousOutputs: { ...phaseOutputs },
      timestamp: new Date().toISOString(),
    }
  }
}
