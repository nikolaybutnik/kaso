/**
 * Backend process manager for CLI-based executor backends
 * Spawns and manages backend processes with NDJSON progress streaming
 */

import { spawn } from 'child_process'
import { createInterface } from 'readline'
import type { ExecutorBackend } from './backend-adapter'
import type { ExecutorBackendConfig } from '../config/schema'
import type {
  BackendRequest,
  BackendResponse,
  BackendProgressEvent,
  BackendProtocol,
} from '../core/types'

/** Timeout before escalating SIGTERM to SIGKILL (ms) */
const SIGKILL_ESCALATION_DELAY = 5000

/**
 * Typed error for backend execution failures
 */
export class BackendExecutionError extends Error {
  readonly exitCode: number | null
  readonly stderr: string[]

  constructor(message: string, exitCode: number | null, stderr: string[]) {
    super(`Backend execution failed: ${message}`)
    this.name = 'BackendExecutionError'
    this.exitCode = exitCode
    this.stderr = stderr
  }
}

/**
 * CLI Process Backend implementation
 * Spawns a child process and communicates via NDJSON protocol
 */
export class CLIProcessBackend implements ExecutorBackend {
  readonly name: string
  readonly protocol: BackendProtocol
  readonly maxContextWindow: number
  readonly costPer1000Tokens: number
  private config: ExecutorBackendConfig
  private progressCallbacks: Array<(event: BackendProgressEvent) => void> = []

  constructor(config: ExecutorBackendConfig) {
    this.config = config
    this.name = config.name
    this.protocol = config.protocol
    this.maxContextWindow = config.maxContextWindow
    this.costPer1000Tokens = config.costPer1000Tokens
  }

  /**
   * Execute a request against the backend
   * @param request - The backend request
   * @returns Promise resolving to backend response
   */
  async execute(request: BackendRequest): Promise<BackendResponse> {
    return new Promise((resolve, reject) => {
      let settled = false

      const safeResolve = (value: BackendResponse): void => {
        if (!settled) {
          settled = true
          resolve(value)
        }
      }

      const safeReject = (reason: Error): void => {
        if (!settled) {
          settled = true
          reject(reason)
        }
      }

      // Build command arguments
      const args = [...this.config.args]

      if (this.config.protocol === 'cli-json') {
        args.push('--json')
      }

      args.push(JSON.stringify(request))

      const child = spawn(this.config.command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      })

      const stdoutLines: string[] = []
      const stderrLines: string[] = []

      const stdoutInterface = createInterface({
        input: child.stdout,
        crlfDelay: Infinity,
      })

      // Parse NDJSON progress events from stdout
      stdoutInterface.on('line', (line) => {
        try {
          const event = JSON.parse(line) as BackendProgressEvent

          // Progress events must have type + timestamp + message per spec
          if (event.type && event.timestamp && event.message) {
            for (const callback of this.progressCallbacks) {
              try {
                callback(event)
              } catch {
                // Swallow callback errors to avoid breaking the backend stream
              }
            }
          } else {
            stdoutLines.push(line)
          }
        } catch {
          stdoutLines.push(line)
        }
      })

      child.stderr.on('data', (data: Buffer) => {
        const lines = data
          .toString()
          .split('\n')
          .filter((line: string) => line.trim())
        stderrLines.push(...lines)
      })

      // Set timeout — SIGTERM first, escalate to SIGKILL
      const timeoutSeconds = request.context.config.defaultPhaseTimeout || 300
      const timeoutMs = timeoutSeconds * 1000
      const timeout = setTimeout(() => {
        child.kill('SIGTERM')
        setTimeout(() => {
          if (!child.killed) {
            child.kill('SIGKILL')
          }
        }, SIGKILL_ESCALATION_DELAY)
        safeReject(
          new Error(`Backend execution timed out after ${timeoutMs}ms`),
        )
      }, timeoutMs)

      child.on('close', (code) => {
        clearTimeout(timeout)

        const responseData = stdoutLines.join('\n')

        if (code === 0) {
          try {
            if (responseData.trim()) {
              const response = JSON.parse(responseData) as BackendResponse

              if (!response.id) {
                safeReject(
                  new Error('Backend response missing required id field'),
                )
                return
              }
              if (typeof response.success !== 'boolean') {
                safeReject(
                  new Error('Backend response missing required success field'),
                )
                return
              }

              safeResolve(response)
            } else {
              safeResolve({
                id: request.id,
                success: true,
                tokensUsed: 0,
                duration: 0,
              })
            }
          } catch (err) {
            safeReject(
              new Error(
                `Failed to parse backend response: ${err instanceof Error ? err.message : String(err)}`,
              ),
            )
          }
        } else {
          const errorMessage =
            stderrLines.join('\n') || `Process exited with code ${code}`
          safeReject(new BackendExecutionError(errorMessage, code, stderrLines))
        }
      })

      child.on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timeout)
        if (err.code === 'ENOENT') {
          safeReject(
            new Error(
              `Backend command '${this.config.command}' not found. Please ensure it's installed and available in PATH.`,
            ),
          )
        } else {
          safeReject(
            new Error(`Failed to spawn backend process: ${err.message}`),
          )
        }
      })
    })
  }

  /**
   * Check if the backend is available (command exists and is executable)
   * @returns Promise resolving to boolean indicating availability
   */
  async isAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      // Use 'which' or 'where' to check if command exists
      const command = process.platform === 'win32' ? 'where' : 'which'
      const check = spawn(command, [this.config.command], {
        stdio: ['ignore', 'ignore', 'ignore'],
      })

      check.on('close', (code) => {
        resolve(code === 0)
      })

      check.on('error', () => {
        resolve(false)
      })
    })
  }

  /**
   * Subscribe to progress events from the backend
   * @param callback - Function to call when progress events are emitted
   */
  onProgress(callback: (event: BackendProgressEvent) => void): void {
    this.progressCallbacks.push(callback)
  }

  /**
   * Get the backend name
   * @deprecated Use the `name` property instead
   */
  getName(): string {
    return this.name
  }
}

/**
 * Mock backend for testing
 * Simulates a backend without spawning actual processes
 */
export class MockBackend implements ExecutorBackend {
  readonly name: string
  readonly protocol: BackendProtocol
  readonly maxContextWindow: number
  readonly costPer1000Tokens: number
  private available: boolean
  private progressCallbacks: Array<(event: BackendProgressEvent) => void> = []

  constructor(name: string, available = true) {
    this.name = name
    this.available = available
    this.protocol = 'cli-json'
    this.maxContextWindow = 128000
    this.costPer1000Tokens = 0.01
  }

  async execute(request: BackendRequest): Promise<BackendResponse> {
    if (!this.available) {
      throw new Error(`Mock backend '${this.name}' is not available`)
    }

    // Simulate progress events
    const events: BackendProgressEvent[] = [
      {
        type: 'progress',
        timestamp: new Date().toISOString(),
        message: 'Starting execution',
      },
      {
        type: 'progress',
        timestamp: new Date().toISOString(),
        message: 'Processing context',
      },
      {
        type: 'progress',
        timestamp: new Date().toISOString(),
        message: 'Generating code',
      },
      {
        type: 'progress',
        timestamp: new Date().toISOString(),
        message: 'Execution complete',
      },
    ]

    for (const event of events) {
      for (const callback of this.progressCallbacks) {
        try {
          callback(event)
        } catch {
          // Swallow callback errors to avoid breaking the backend stream
        }
      }
      // Simulate async delay
      await new Promise((resolve) => setTimeout(resolve, 10))
    }

    return {
      id: request.id,
      success: true,
      tokensUsed: 1000,
      duration: 100,
      output: {
        modifiedFiles: ['src/example.ts'],
        addedTests: ['tests/example.test.ts'],
      },
    }
  }

  async isAvailable(): Promise<boolean> {
    return this.available
  }

  onProgress(callback: (event: BackendProgressEvent) => void): void {
    this.progressCallbacks.push(callback)
  }

  /** @deprecated Use the `name` property instead */
  getName(): string {
    return this.name
  }
}
