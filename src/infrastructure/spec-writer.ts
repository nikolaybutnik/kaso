/**
 * Spec Writer - Writes execution logs and status updates back to Kiro spec directories
 * Implements bidirectional Kiro communication (Req 3.1, 3.2, 3.3)
 */

import { promises as fs } from 'fs'
import { join } from 'path'
import type { PhaseName, RunStatus } from '../core/types'

/**
 * Status data structure written to status.json
 */
export interface SpecStatus {
  currentPhase?: PhaseName
  runStatus: RunStatus
  lastUpdated: string
  runId?: string
}

/**
 * Log entry structure for execution-log.md
 */
export interface ExecutionLogEntry {
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  source: string
  message: string
  phase?: PhaseName
  runId?: string
  data?: Record<string, unknown>
}

/**
 * Spec Writer - handles writing execution state back to spec directories
 */
export class SpecWriter {
  /**
   * Write an execution log entry to the spec's execution-log.md file
   * Creates the log file and spec directory if they don't exist
   */
  async appendExecutionLog(
    specPath: string,
    entry: ExecutionLogEntry,
  ): Promise<void> {
    const logFilePath = join(specPath, 'execution-log.md')
    const logLine = this.formatLogEntry(entry)

    try {
      // Ensure directory exists
      await fs.mkdir(specPath, { recursive: true })

      // Append log entry
      await fs.appendFile(logFilePath, logLine + '\n', 'utf-8')
    } catch (error) {
      // Gracefully degrade: log warning but don't crash orchestrator
      console.warn(
        `[SpecWriter] Failed to write execution log for ${specPath}:`,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  /**
   * Update the spec's status.json with current phase and run status
   * Creates the file if it doesn't exist
   */
  async updateSpecStatus(specPath: string, status: SpecStatus): Promise<void> {
    const statusFilePath = join(specPath, 'status.json')

    try {
      // Ensure directory exists
      await fs.mkdir(specPath, { recursive: true })

      // Write status JSON
      const content = JSON.stringify(status, null, 2)
      await fs.writeFile(statusFilePath, content, 'utf-8')
    } catch (error) {
      // Gracefully degrade: log warning but don't crash orchestrator
      console.warn(
        `[SpecWriter] Failed to update status.json for ${specPath}:`,
        error instanceof Error ? error.message : String(error),
      )
    }
  }

  /**
   * Format a log entry for execution-log.md in Kiro-compatible format
   * Example:
   * ```
   * [2024-01-15T10:30:00.000Z] [info] [orchestrator] Phase intake started
   * ```
   */
  private formatLogEntry(entry: ExecutionLogEntry): string {
    const { timestamp, level, source, message, phase, runId, data } = entry

    let logLine = `[${timestamp}] [${level}] [${source}]`

    if (phase) {
      logLine += ` [${phase}]`
    }

    if (runId) {
      logLine += ` (run: ${runId})`
    }

    logLine += ` ${message}`

    if (data && Object.keys(data).length > 0) {
      const dataStr = JSON.stringify(data, null, 2)
      logLine += `\n${dataStr}`
    }

    return logLine
  }

  /**
   * Write initial execution log entry when run starts
   */
  async writeRunStarted(
    specPath: string,
    runId: string,
    worktreePath: string,
  ): Promise<void> {
    const timestamp = new Date().toISOString()

    await this.appendExecutionLog(specPath, {
      timestamp,
      level: 'info',
      source: 'orchestrator',
      message: `Execution run ${runId} started`,
      runId,
      data: { worktreePath },
    })

    await this.updateSpecStatus(specPath, {
      runStatus: 'running',
      lastUpdated: timestamp,
      runId,
      currentPhase: undefined,
    })
  }

  /**
   * Write phase transition log entry
   */
  async writePhaseTransition(
    specPath: string,
    runId: string,
    phase: PhaseName,
    result: 'started' | 'completed' | 'failed',
    durationMs?: number,
    error?: string,
  ): Promise<void> {
    const timestamp = new Date().toISOString()

    const entry: ExecutionLogEntry = {
      timestamp,
      level: result === 'failed' ? 'error' : 'info',
      source: 'orchestrator',
      message: `Phase ${phase} ${result}`,
      phase,
      runId,
    }

    if (durationMs !== undefined) {
      entry.data = { durationMs: Math.round(durationMs) }
    }

    if (error) {
      entry.data = { ...entry.data, error }
    }

    await this.appendExecutionLog(specPath, entry)

    // Update status with current phase
    await this.updateSpecStatus(specPath, {
      runStatus: 'running',
      lastUpdated: timestamp,
      runId,
      currentPhase: phase,
    })
  }

  /**
   * Write final log entry when run completes or fails
   */
  async writeRunCompleted(
    specPath: string,
    runId: string,
    status: 'completed' | 'failed' | 'cancelled',
    totalCost?: number,
    error?: string,
  ): Promise<void> {
    const timestamp = new Date().toISOString()

    const entry: ExecutionLogEntry = {
      timestamp,
      level: status === 'failed' ? 'error' : 'info',
      source: 'orchestrator',
      message: `Execution run ${runId} ${status}`,
      runId,
    }

    if (totalCost !== undefined) {
      entry.data = { totalCost: Math.round(totalCost * 100) / 100 }
    }

    if (error) {
      entry.data = { ...entry.data, error }
    }

    await this.appendExecutionLog(specPath, entry)

    await this.updateSpecStatus(specPath, {
      runStatus: status,
      lastUpdated: timestamp,
      runId,
      currentPhase: undefined, // Run is complete, no current phase
    })
  }
}
