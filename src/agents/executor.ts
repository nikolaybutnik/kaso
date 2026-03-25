/**
 * Executor Agent (Phase 4 — Implementation)
 * Delegates implementation tasks to configured ExecutorBackend
 * Handles self-correction on test failures with internal retry logic
 */

import type {
  AgentContext,
  AgentResult,
  ImplementationResult,
  AssembledContext,
  ValidationReport,
  BackendProgressEvent,
  PhaseOutput,
} from '@/core/types'
import type { Agent } from './agent-interface'
import { BackendRegistry } from '@/backends/backend-registry'
import type { ExecutorBackend } from '@/backends/backend-adapter'
import { BackendExecutionError } from '@/backends/backend-process'
import { EventBus } from '@/core/event-bus'

/** Estimated duration for executor agent in milliseconds */
const ESTIMATED_DURATION_MS = 60000

/** Maximum self-correction retries (internal to executor agent) */
const MAX_SELF_CORRECTION_RETRIES = 3

/** Phase name type for error tracking */
interface ExtendedPhaseOutputs extends Partial<
  Record<import('@/core/types').PhaseName, PhaseOutput>
> {
  implementation_error?: PhaseOutput
}

/**
 * ExecutorAgent implementation
 * Handles Phase 4: Implementation by delegating to AI backends
 */
export class ExecutorAgent implements Agent {
  private eventBus: EventBus
  private backendRegistry: BackendRegistry | null = null

  constructor(eventBus?: EventBus, backendRegistry?: BackendRegistry) {
    this.eventBus = eventBus ?? new EventBus()
    this.backendRegistry = backendRegistry ?? null
  }

  /**
   * Set the backend registry (for testing or custom registry)
   */
  setBackendRegistry(registry: BackendRegistry): void {
    this.backendRegistry = registry
  }

  /**
   * Execute the implementation phase
   * Delegates to backend with self-correction retry logic
   */
  async execute(context: AgentContext): Promise<AgentResult> {
    const startTime = Date.now()
    let selfCorrectionAttempts = 0
    let lastError: string | undefined

    try {
      // Validate required context
      this.validateContext(context)

      // Initialize backend registry if not already done
      if (!this.backendRegistry) {
        this.backendRegistry = new BackendRegistry(context.config)
      }

      // Check for abort signal
      if (context.abortSignal?.aborted) {
        return {
          success: false,
          error: {
            message: 'Execution aborted',
            retryable: false,
          },
          duration: Date.now() - startTime,
        }
      }

      // Execute with self-correction loop
      while (selfCorrectionAttempts <= MAX_SELF_CORRECTION_RETRIES) {
        // Check for abort before each attempt
        if (context.abortSignal?.aborted) {
          return {
            success: false,
            error: {
              message:
                'Execution aborted during attempt ' +
                (selfCorrectionAttempts + 1),
              retryable: false,
            },
            duration: Date.now() - startTime,
          }
        }

        const attemptStartTime = Date.now()
        const attemptNumber = selfCorrectionAttempts + 1

        // Emit progress event for new attempt
        this.emitProgress(
          context.runId,
          `Starting implementation attempt ${attemptNumber}/${MAX_SELF_CORRECTION_RETRIES + 1}`,
        )

        try {
          const result = await this.executeAttempt(
            context,
            lastError,
            attemptStartTime,
          )

          if (result.success) {
            // Add self-correction attempts to result
            if (result.output) {
              ;(result.output as ImplementationResult).selfCorrectionAttempts =
                selfCorrectionAttempts
            }
            return result
          }

          // Execution returned but was not successful
          lastError = result.error?.message ?? 'Unknown error'
          selfCorrectionAttempts++

          if (selfCorrectionAttempts <= MAX_SELF_CORRECTION_RETRIES) {
            this.emitProgress(
              context.runId,
              `Attempt ${attemptNumber} failed, retrying with error context: ${lastError}`,
            )
          }
        } catch (error) {
          // Backend execution threw an error
          lastError = error instanceof Error ? error.message : String(error)
          selfCorrectionAttempts++

          if (selfCorrectionAttempts <= MAX_SELF_CORRECTION_RETRIES) {
            this.emitProgress(
              context.runId,
              `Attempt ${attemptNumber} threw error, retrying: ${lastError}`,
            )
          }
          // If retries exhausted, loop will exit and we'll return error below
        }
      }

      // All retries exhausted
      return {
        success: false,
        error: {
          message: `Implementation failed after ${MAX_SELF_CORRECTION_RETRIES + 1} attempts. Last error: ${lastError}`,
          retryable: true,
          data: { selfCorrectionAttempts, lastError },
        },
        duration: Date.now() - startTime,
      }
    } catch (error) {
      return {
        success: false,
        error: this.formatError(error),
        duration: Date.now() - startTime,
      }
    }
  }

  /**
   * Execute a single implementation attempt
   */
  private async executeAttempt(
    context: AgentContext,
    previousError: string | undefined,
    startTime: number,
  ): Promise<AgentResult> {
    // Build backend request
    const request = this.buildBackendRequest(context, previousError)

    // Get the backend
    const backend = this.selectBackend(context)

    // Set up progress event forwarding
    const progressHandler = (event: BackendProgressEvent): void => {
      this.eventBus.emit({
        type: 'agent:progress',
        runId: context.runId,
        timestamp: event.timestamp,
        phase: 'implementation',
        agent: 'executor',
        data: {
          message: event.message,
          backendData: event.data,
        },
      })
    }

    backend.onProgress(progressHandler)

    // Execute via backend
    this.emitProgress(context.runId, `Delegating to backend: ${backend.name}`)
    const response = await backend.execute(request)

    if (!response.success) {
      return {
        success: false,
        error: {
          message: response.error ?? 'Backend execution failed',
          retryable: true,
        },
        duration: Date.now() - startTime,
        tokensUsed: response.tokensUsed,
      }
    }

    // Extract implementation result from response
    const output = response.output as Partial<ImplementationResult> | undefined

    const implementationResult: ImplementationResult = {
      modifiedFiles: output?.modifiedFiles ?? [],
      addedTests: output?.addedTests ?? [],
      duration: Date.now() - startTime,
      backend: backend.name,
      selfCorrectionAttempts: 0, // Will be set by caller
    }

    return {
      success: true,
      output: implementationResult,
      duration: Date.now() - startTime,
      tokensUsed: response.tokensUsed,
    }
  }

  /**
   * Build the backend request with full context
   */
  private buildBackendRequest(
    context: AgentContext,
    previousError?: string,
  ): import('@/core/types').BackendRequest {
    // Build comprehensive context for the backend
    const requestContext: AgentContext = {
      ...context,
      // Include previous error for self-correction context
      phaseOutputs: previousError
        ? ({
            ...context.phaseOutputs,
            implementation_error: {
              error: previousError,
              attempt: 'self-correction',
            },
          } as ExtendedPhaseOutputs)
        : context.phaseOutputs,
    }

    return {
      id: `${context.runId}-implementation-${Date.now()}`,
      context: requestContext,
      phase: 'implementation',
      streamProgress: true,
    }
  }

  /**
   * Select the appropriate backend
   */
  private selectBackend(context: AgentContext): ExecutorBackend {
    if (!this.backendRegistry) {
      throw new Error('Backend registry not initialized')
    }

    // Use preferred backend if specified (e.g., from retry with alternative backend)
    if (context.preferredBackend) {
      return this.backendRegistry.getBackend(context.preferredBackend)
    }

    // Otherwise use context-aware selection
    return this.backendRegistry.selectBackend(context)
  }

  /**
   * Validate that all required context is present
   */
  private validateContext(context: AgentContext): void {
    const assembledContext = context.phaseOutputs['intake'] as
      | AssembledContext
      | undefined
    if (!assembledContext) {
      throw new Error('Missing intake phase output (assembled context)')
    }

    const validationReport = context.phaseOutputs['validation'] as
      | ValidationReport
      | undefined
    if (!validationReport) {
      throw new Error('Missing validation phase output (validation report)')
    }

    if (!validationReport.approved) {
      throw new Error(
        'Spec validation failed - cannot proceed with implementation',
      )
    }

    if (!context.architecture) {
      throw new Error('Missing architecture context from Phase 3')
    }

    if (!context.worktreePath) {
      throw new Error(
        'Missing worktree path - file operations require isolated worktree',
      )
    }
  }

  /**
   * Emit a progress event
   */
  private emitProgress(runId: string, message: string): void {
    this.eventBus.emit({
      type: 'agent:progress',
      runId,
      timestamp: new Date().toISOString(),
      phase: 'implementation',
      agent: 'executor',
      data: { message },
    })
  }

  /**
   * Format an error for agent result
   */
  private formatError(error: unknown): import('@/core/types').AgentError {
    if (error instanceof BackendExecutionError) {
      return {
        message: `Backend execution failed: ${error.message}`,
        code: `BACKEND_EXIT_${error.exitCode ?? 'UNKNOWN'}`,
        retryable: true,
        data: {
          stderr: error.stderr,
          exitCode: error.exitCode,
        },
      }
    }

    if (error instanceof Error) {
      return {
        message: error.message,
        retryable: !error.message.includes('validation failed'),
      }
    }

    return {
      message: String(error),
      retryable: true,
    }
  }

  /**
   * Check if this agent supports rollback
   */
  supportsRollback(): boolean {
    // Implementation changes can be rolled back via git
    return true
  }

  /**
   * Get estimated duration for this agent
   */
  estimatedDuration(): number {
    // Implementation can take significant time depending on spec complexity
    return ESTIMATED_DURATION_MS
  }

  /**
   * Get required context keys
   */
  requiredContext(): string[] {
    return [
      'phaseOutputs.intake',
      'phaseOutputs.validation',
      'architecture',
      'worktreePath',
    ]
  }
}

/**
 * Create a new ExecutorAgent instance
 * @param eventBus - Optional event bus for progress streaming
 * @param backendRegistry - Optional backend registry for testing
 * @returns ExecutorAgent instance
 */
export function createExecutorAgent(
  eventBus?: EventBus,
  backendRegistry?: BackendRegistry,
): ExecutorAgent {
  return new ExecutorAgent(eventBus, backendRegistry)
}
