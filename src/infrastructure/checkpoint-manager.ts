/**
 * Checkpoint manager for KASO
 * Manages write-ahead persistence for crash recovery
 */

import type Database from 'better-sqlite3'
import type { ExecutionStore } from './execution-store'
import type {
  ExecutionRunRecord,
  PhaseName,
  PhaseResultRecord,
} from '../core/types'

/**
 * Checkpoint record stored in SQLite
 */
export interface CheckpointRecord {
  id: number
  runId: string
  phase: PhaseName
  data: unknown
  createdAt: string
  isLatest: boolean
}

/**
 * Typed recovery payload returned by recoverFromCheckpoint
 */
export interface CheckpointRecoveryData {
  run: ExecutionRunRecord
  phaseResults: PhaseResultRecord[]
  [key: string]: unknown
}

/** Raw row shape returned by better-sqlite3 for the checkpoints table */
interface CheckpointRow {
  id: number
  run_id: string
  phase: string
  data: string
  created_at: string
  is_latest: number
}

/**
 * Checkpoint manager class
 * Handles write-ahead persistence before phase transitions
 */
export class CheckpointManager {
  private readonly store: ExecutionStore

  constructor(executionStore: ExecutionStore) {
    this.store = executionStore
  }

  /** Get the SQLite database or throw if in JSONL mode */
  private requireDb(): Database.Database {
    const db = this.store.getDatabase()
    if (!db) {
      throw new Error('Checkpoints require SQLite storage')
    }
    return db
  }

  /**
   * Save a checkpoint before phase transition
   * @param runId - The execution run ID
   * @param phase - The phase being checkpointed
   * @param data - The complete state snapshot to save
   */
  saveCheckpoint(runId: string, phase: PhaseName, data: unknown): void {
    const db = this.requireDb()

    // Clear previous latest flag
    db.prepare(
      'UPDATE checkpoints SET is_latest = 0 WHERE run_id = @run_id',
    ).run({ run_id: runId })

    // Insert new checkpoint as latest
    db.prepare(
      `
      INSERT INTO checkpoints (run_id, phase, data, is_latest)
      VALUES (@run_id, @phase, @data, 1)
    `,
    ).run({
      run_id: runId,
      phase,
      data: JSON.stringify(data),
    })

    // Verify write-ahead succeeded
    const saved = this.getLatestCheckpoint(runId)
    if (!saved) {
      throw new Error(`Failed to save checkpoint for run ${runId}`)
    }
  }

  /**
   * Get the latest checkpoint for a run
   */
  getLatestCheckpoint(runId: string): CheckpointRecord | null {
    const db = this.requireDb()

    const row = db
      .prepare(
        `
      SELECT * FROM checkpoints
      WHERE run_id = @run_id AND is_latest = 1
      ORDER BY created_at DESC
      LIMIT 1
    `,
      )
      .get({ run_id: runId }) as CheckpointRow | undefined

    if (!row) {
      return null
    }

    return this.rowToCheckpoint(row)
  }

  /**
   * Clear all checkpoints for a run
   */
  clearCheckpoints(runId: string): void {
    const db = this.requireDb()
    db.prepare('DELETE FROM checkpoints WHERE run_id = @run_id').run({
      run_id: runId,
    })
  }

  /**
   * Check if a run has any checkpoints
   */
  hasCheckpoints(runId: string): boolean {
    const db = this.requireDb()

    const row = db
      .prepare(
        'SELECT COUNT(*) as count FROM checkpoints WHERE run_id = @run_id',
      )
      .get({ run_id: runId }) as { count: number }

    return row.count > 0
  }

  /**
   * Create a checkpoint from the current run state
   * @param runId - The execution run ID
   * @param runRecord - The current run record
   */
  createFromRun(runId: string, runRecord: ExecutionRunRecord): void {
    const currentPhase = runRecord.currentPhase ?? 'intake'
    const phaseResults = this.store.getPhaseResults(runId)

    this.saveCheckpoint(runId, currentPhase, {
      run: runRecord,
      phaseResults,
    })
  }

  /**
   * Recover run state from latest checkpoint
   * @returns Typed recovery data, or null if no checkpoint exists
   */
  recoverFromCheckpoint(runId: string): CheckpointRecoveryData | null {
    const checkpoint = this.getLatestCheckpoint(runId)
    if (!checkpoint) {
      return null
    }

    if (!checkpoint.data || typeof checkpoint.data !== 'object') {
      throw new Error(`Invalid checkpoint data for run ${runId}`)
    }

    return checkpoint.data as CheckpointRecoveryData
  }

  /**
   * List all checkpoints for a run
   */
  listCheckpoints(runId: string): CheckpointRecord[] {
    const db = this.requireDb()

    const rows = db
      .prepare(
        `
      SELECT * FROM checkpoints
      WHERE run_id = @run_id
      ORDER BY created_at DESC
    `,
      )
      .all({ run_id: runId }) as CheckpointRow[]

    return rows.map((row) => this.rowToCheckpoint(row))
  }

  /**
   * Get checkpoint count for a run
   */
  getCheckpointCount(runId: string): number {
    const db = this.requireDb()

    const row = db
      .prepare(
        'SELECT COUNT(*) as count FROM checkpoints WHERE run_id = @run_id',
      )
      .get({ run_id: runId }) as { count: number }

    return row.count
  }

  /**
   * Clean up old checkpoints, keeping only the latest N
   * @param runId - The execution run ID
   * @param keepCount - Number of latest checkpoints to keep
   */
  cleanupOldCheckpoints(runId: string, keepCount = 5): void {
    const db = this.requireDb()

    db.prepare(
      `
      DELETE FROM checkpoints
      WHERE run_id = @run_id
        AND id NOT IN (
          SELECT id FROM checkpoints
          WHERE run_id = @run_id
          ORDER BY created_at DESC
          LIMIT @keep_count
        )
    `,
    ).run({ run_id: runId, keep_count: keepCount })
  }

  /** Convert a raw DB row to a CheckpointRecord */
  private rowToCheckpoint(row: CheckpointRow): CheckpointRecord {
    return {
      id: row.id,
      runId: row.run_id,
      phase: row.phase as PhaseName,
      data: JSON.parse(row.data),
      createdAt: row.created_at,
      isLatest: row.is_latest === 1,
    }
  }
}

export default CheckpointManager
