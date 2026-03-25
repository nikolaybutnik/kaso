/**
 * Mock Backend for E2E Testing
 *
 * Implements ExecutorBackend interface with configurable behavior
 * for testing the KASO pipeline without real AI backends.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7
 */

import type {
  BackendRequest,
  BackendResponse,
  BackendProgressEvent,
  PhaseOutput,
  PhaseName,
} from '@/core/types'
import type { ExecutorBackend } from '@/backends/backend-adapter'
import type { BackendProtocol } from '@/core/types'

/**
 * Configuration for MockBackend
 */
export interface MockBackendConfig {
  /** Backend identifier */
  name: string
  /** Communication protocol */
  protocol?: BackendProtocol
  /** Maximum context window size in tokens */
  maxContextWindow?: number
  /** Cost per 1000 tokens in USD */
  costPer1000Tokens?: number
  /** Default tokens used for responses */
  defaultTokensUsed?: number
  /** Default delay in milliseconds */
  defaultDelay?: number
}

/**
 * Response configuration for a specific phase
 */
export interface MockPhaseResponse {
  /** Whether the execution succeeded */
  success: boolean
  /** Output data for successful execution */
  output?: PhaseOutput
  /** Tokens consumed by this execution */
  tokensUsed?: number
  /** Error message for failed execution */
  error?: string
  /** Whether the error is retryable */
  retryable?: boolean
}

/**
 * Preset configuration for backend behavior
 */
export interface MockBackendPreset {
  /** Backend name */
  name: string
  /** Per-phase response configurations */
  phaseResponses?: Map<PhaseName, MockPhaseResponse>
  /** Delay before responding */
  delayMs?: number
  /** Whether the backend is available */
  available?: boolean
}

/**
 * Mock implementation of ExecutorBackend for E2E testing
 */
export class MockBackend implements ExecutorBackend {
  readonly name: string
  readonly protocol: BackendProtocol
  readonly maxContextWindow: number
  readonly costPer1000Tokens: number

  private phaseResponses: Map<PhaseName, MockPhaseResponse>
  private progressCallbacks: Array<(event: BackendProgressEvent) => void>
  private executionLog: BackendRequest[]
  private available: boolean
  private delayMs: number
  private defaultTokensUsed: number

  constructor(config: MockBackendConfig) {
    this.name = config.name
    this.protocol = config.protocol ?? 'cli-json'
    this.maxContextWindow = config.maxContextWindow ?? 128000
    this.costPer1000Tokens = config.costPer1000Tokens ?? 0.01
    this.defaultTokensUsed = config.defaultTokensUsed ?? 1000
    this.delayMs = config.defaultDelay ?? 0

    this.phaseResponses = new Map()
    this.progressCallbacks = []
    this.executionLog = []
    this.available = true
  }

  /**
   * Configure response for a specific phase
   * @param phase - Phase name
   * @param response - Response configuration
   */
  setPhaseResponse(phase: PhaseName, response: MockPhaseResponse): void {
    this.phaseResponses.set(phase, response)
  }

  /**
   * Configure a delay before responding
   * @param ms - Delay in milliseconds
   */
  setDelay(ms: number): void {
    this.delayMs = ms
  }

  /**
   * Set availability (for testing unavailable backends)
   * @param available - Whether the backend is available
   */
  setAvailable(available: boolean): void {
    this.available = available
  }

  /**
   * Get log of all execute() calls for assertion
   * @returns Array of backend requests
   */
  getExecutionLog(): BackendRequest[] {
    return [...this.executionLog]
  }

  /**
   * Reset execution log
   */
  resetLog(): void {
    this.executionLog = []
  }

  /**
   * Subscribe to progress events from the backend
   * @param callback - Function to call when progress events are emitted
   */
  onProgress(callback: (event: BackendProgressEvent) => void): void {
    this.progressCallbacks.push(callback)
  }

  /**
   * Check if the backend is available
   * @returns Promise resolving to availability status
   */
  async isAvailable(): Promise<boolean> {
    return this.available
  }

  /**
   * Execute a request against the backend
   * @param request - The backend request
   * @returns Promise resolving to backend response
   */
  async execute(request: BackendRequest): Promise<BackendResponse> {
    // Log the execution
    this.executionLog.push(request)

    // Apply configured delay
    if (this.delayMs > 0) {
      await this.sleep(this.delayMs)
    }

    // Emit at least 2 progress events (requirement 2.3)
    this.emitProgress({
      type: 'progress',
      timestamp: new Date().toISOString(),
      message: `Starting execution for phase: ${request.phase}`,
      data: { phase: request.phase },
    })

    this.emitProgress({
      type: 'progress',
      timestamp: new Date().toISOString(),
      message: `Processing phase: ${request.phase}`,
      data: { phase: request.phase, progress: 50 },
    })

    // Get configured response for this phase or use default
    const phaseResponse = this.phaseResponses.get(request.phase)

    if (phaseResponse) {
      // Emit completion progress
      this.emitProgress({
        type: 'complete',
        timestamp: new Date().toISOString(),
        message: `Completed phase: ${request.phase}`,
        data: { phase: request.phase, success: phaseResponse.success },
      })

      return {
        id: request.id,
        success: phaseResponse.success,
        output: phaseResponse.output,
        error: phaseResponse.error,
        tokensUsed: phaseResponse.tokensUsed ?? this.defaultTokensUsed,
        duration: this.delayMs,
      }
    }

    // Default success response
    this.emitProgress({
      type: 'complete',
      timestamp: new Date().toISOString(),
      message: `Completed phase: ${request.phase}`,
      data: { phase: request.phase, success: true },
    })

    return {
      id: request.id,
      success: true,
      tokensUsed: this.defaultTokensUsed,
      duration: this.delayMs,
    }
  }

  /**
   * Emit a progress event to all subscribers
   * @param event - Progress event to emit
   */
  private emitProgress(event: BackendProgressEvent): void {
    for (const callback of this.progressCallbacks) {
      callback(event)
    }
  }

  /**
   * Sleep for specified milliseconds
   * @param ms - Milliseconds to sleep
   * @returns Promise that resolves after the delay
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
