/**
 * Backend adapter interface for executor backends
 * Defines the contract for pluggable AI coding backends
 */

import type {
  BackendRequest,
  BackendResponse,
  BackendProgressEvent,
  BackendProtocol,
} from '../core/types'

/**
 * Executor backend interface
 * All executor backends must implement this interface
 */
export interface ExecutorBackend {
  /** Backend identifier */
  readonly name: string

  /** Communication protocol used by this backend */
  readonly protocol: BackendProtocol

  /** Maximum context window size in tokens */
  readonly maxContextWindow: number

  /** Cost per 1000 tokens in USD */
  readonly costPer1000Tokens: number

  /**
   * Execute a request against the backend
   * @param request - The backend request containing context and execution parameters
   * @returns Promise resolving to backend response
   */
  execute(request: BackendRequest): Promise<BackendResponse>

  /**
   * Check if the backend is available (command exists and is executable)
   * @returns Promise resolving to boolean indicating availability
   */
  isAvailable(): Promise<boolean>

  /**
   * Subscribe to progress events from the backend
   * @param callback - Function to call when progress events are emitted
   */
  onProgress(callback: (event: BackendProgressEvent) => void): void
}
