/**
 * Execution store for KASO
 * Persists execution state to SQLite (primary) or JSONL (fallback)
 */

import Database from 'better-sqlite3'
import { existsSync, mkdirSync, appendFileSync } from 'fs'
import { dirname, join } from 'path'
import type {
  ExecutionRunRecord,
  PhaseResultRecord,
  PhaseResult,
  RunStatus,
  PhaseName,
} from '@/core/types'

/**
 * Execution store configuration
 */
export interface ExecutionStoreConfig {
  type: 'sqlite' | 'jsonl'
  path?: string
}

/**
 * Execution store class
 * Manages persistence of execution runs and phase results
 */
export class ExecutionStore {
  private readonly config: ExecutionStoreConfig
  private db: Database.Database | null = null
  private jsonlPath: string | null = null
  private jsonlBuffer: string[] = []
  private jsonlRunIndex: Map<string, { offset: number; length: number }> =
    new Map()

  constructor(config: ExecutionStoreConfig) {
    this.config = config

    if (config.type === 'sqlite') {
      this.initSQLite()
    } else {
      this.initJSONL()
    }
  }

  /**
   * Get the underlying SQLite database instance.
   * Used by components that need direct DB access (e.g. CheckpointManager).
   * @returns The database instance or null if using JSONL mode
   */
  getDatabase(): Database.Database | null {
    return this.db
  }

  /**
   * Initialize SQLite database
   */
  private initSQLite(): void {
    const dbPath =
      this.config.path || join(process.cwd(), '.kaso', 'execution-store.db')

    // Ensure directory exists
    const dbDir = dirname(dbPath)
    if (!existsSync(dbDir)) {
      mkdirSync(dbDir, { recursive: true })
    }

    this.db = new Database(dbPath)

    // Enable WAL mode for better concurrency (disabled for :memory: as it can cause issues)
    if (dbPath !== ':memory:') {
      this.db.pragma('journal_mode = WAL')
    }

    this.createSchema()
  }

  /**
   * Create database schema
   */
  private createSchema(): void {
    if (!this.db) {
      throw new Error('Database not initialized')
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        spec_path TEXT NOT NULL,
        status TEXT NOT NULL,
        current_phase TEXT,
        phases TEXT NOT NULL,
        started_at TEXT NOT NULL,
        paused_at TEXT,
        completed_at TEXT,
        worktree_path TEXT,
        cost REAL DEFAULT 0.0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `)

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS phase_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        phase TEXT NOT NULL,
        status TEXT NOT NULL,
        output TEXT,
        error TEXT,
        started_at TEXT NOT NULL,
        completed_at TEXT,
        duration INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
      )
    `)

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)`)
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_phase_results_run_id ON phase_results(run_id)`,
    )
    this.db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_phase_results_run_sequence ON phase_results(run_id, sequence)`,
    )
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_phase_results_run_phase ON phase_results(run_id, phase)`,
    )

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        phase TEXT NOT NULL,
        data TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        is_latest INTEGER DEFAULT 0,
        FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
      )
    `)

    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_checkpoints_run_id ON checkpoints(run_id)`,
    )
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_checkpoints_run_latest ON checkpoints(run_id, is_latest)`,
    )
  }

  /**
   * Initialize JSONL store
   */
  private initJSONL(): void {
    const filePath =
      this.config.path || join(process.cwd(), '.kaso', 'execution-store.jsonl')
    const fileDir = dirname(filePath)

    if (!existsSync(fileDir)) {
      mkdirSync(fileDir, { recursive: true })
    }

    this.jsonlPath = filePath
  }

  /**
   * Save or update a run record
   */
  saveRun(run: ExecutionRunRecord): void {
    if (this.db) {
      this.saveRunSQLite(run)
    } else {
      this.saveRunJSONL(run)
    }
  }

  /**
   * Save run to SQLite
   */
  private saveRunSQLite(run: ExecutionRunRecord): void {
    if (!this.db) {
      throw new Error('Database not initialized')
    }

    // Use INSERT OR REPLACE for new runs, UPDATE for existing runs to avoid CASCADE DELETE
    const existingRun = this.db.prepare('SELECT 1 FROM runs WHERE id = ?').get(run.runId)
    
    if (existingRun) {
      // Update existing run to avoid CASCADE DELETE of phase_results
      const stmt = this.db.prepare(`
        UPDATE runs SET
          spec_path = @spec_path,
          status = @status,
          current_phase = @current_phase,
          phases = @phases,
          started_at = @started_at,
          paused_at = @paused_at,
          completed_at = @completed_at,
          worktree_path = @worktree_path,
          cost = @cost,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = @id
      `)
      stmt.run({
        id: run.runId,
        spec_path: run.specPath,
        status: run.status,
        current_phase: run.currentPhase,
        phases: JSON.stringify(run.phases),
        started_at: run.startedAt,
        paused_at: run.pausedAt,
        completed_at: run.completedAt,
        worktree_path: run.worktreePath,
        cost: run.cost,
      })
    } else {
      // Insert new run
      const stmt = this.db.prepare(`
        INSERT INTO runs (
          id, spec_path, status, current_phase, phases, started_at, paused_at, completed_at, worktree_path, cost
        ) VALUES (
          @id, @spec_path, @status, @current_phase, @phases, @started_at, @paused_at, @completed_at, @worktree_path, @cost
        )
      `)
      stmt.run({
        id: run.runId,
        spec_path: run.specPath,
        status: run.status,
        current_phase: run.currentPhase,
        phases: JSON.stringify(run.phases),
        started_at: run.startedAt,
        paused_at: run.pausedAt,
        completed_at: run.completedAt,
        worktree_path: run.worktreePath,
        cost: run.cost,
      })
    }
  }

  /**
   * Save run to JSONL
   */
  private saveRunJSONL(run: ExecutionRunRecord): void {
    const entry = JSON.stringify({ type: 'run', data: run })
    this.jsonlBuffer.push(entry)
    this.flushJSONL()
  }

  /**
   * Get a run by ID
   */
  getRun(runId: string): ExecutionRunRecord | null {
    if (this.db) {
      return this.getRunSQLite(runId)
    }
    return this.getRunJSONL(runId)
  }

  /**
   * Get run from SQLite
   */
  private getRunSQLite(runId: string): ExecutionRunRecord | null {
    if (!this.db) {
      throw new Error('Database not initialized')
    }

    const stmt = this.db.prepare('SELECT * FROM runs WHERE id = ?')
    const row = stmt.get(runId) as Record<string, unknown> | undefined

    if (!row) {
      return null
    }

    return this.rowToRunRecord(row)
  }

  /**
   * Convert database row to ExecutionRunRecord
   */
  private rowToRunRecord(row: Record<string, unknown>): ExecutionRunRecord {
    return {
      runId: row.id as string,
      specPath: row.spec_path as string,
      status: row.status as RunStatus,
      currentPhase: (row.current_phase ?? undefined) as PhaseName | undefined,
      phases: JSON.parse(row.phases as string),
      startedAt: row.started_at as string,
      pausedAt: (row.paused_at ?? undefined) as string | undefined,
      completedAt: (row.completed_at ?? undefined) as string | undefined,
      worktreePath: (row.worktree_path ?? undefined) as string | undefined,
      cost: row.cost as number,
      phaseResults: [],
      logs: [],
    }
  }

  /**
   * Get run from JSONL
   */
  private getRunJSONL(runId: string): ExecutionRunRecord | null {
    const index = this.jsonlRunIndex.get(runId)
    if (!index) {
      return null
    }

    // Full JSONL implementation would require file reading logic
    return null
  }

  /**
   * Get runs with optional limit (alias for listRuns)
   */
  getRuns(limit = 100): ExecutionRunRecord[] {
    return this.listRuns(limit, 0)
  }

  /**
   * List runs with pagination
   */
  listRuns(limit = 100, offset = 0): ExecutionRunRecord[] {
    if (this.db) {
      return this.listRunsSQLite(limit, offset)
    }
    return this.listRunsJSONL(limit, offset)
  }

  /**
   * List runs from SQLite
   */
  private listRunsSQLite(limit: number, offset: number): ExecutionRunRecord[] {
    if (!this.db) {
      throw new Error('Database not initialized')
    }

    const stmt = this.db.prepare(`
      SELECT * FROM runs
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `)

    const rows = stmt.all(limit, offset) as Record<string, unknown>[]
    return rows.map((row) => this.rowToRunRecord(row))
  }

  /**
   * List runs from JSONL
   */
  private listRunsJSONL(_limit: number, _offset: number): ExecutionRunRecord[] {
    // Full JSONL implementation would require reading and parsing file
    return []
  }

  /**
   * Get interrupted runs (non-terminal states)
   */
  getInterruptedRuns(): ExecutionRunRecord[] {
    if (this.db) {
      return this.getInterruptedRunsSQLite()
    }
    return this.getInterruptedRunsJSONL()
  }

  /**
   * Get interrupted runs from SQLite
   */
  private getInterruptedRunsSQLite(): ExecutionRunRecord[] {
    if (!this.db) {
      throw new Error('Database not initialized')
    }

    const stmt = this.db.prepare(`
      SELECT * FROM runs
      WHERE status IN ('running', 'paused')
      ORDER BY updated_at DESC
    `)

    const rows = stmt.all() as Record<string, unknown>[]
    return rows.map((row) => this.rowToRunRecord(row))
  }

  /**
   * Get interrupted runs from JSONL
   */
  private getInterruptedRunsJSONL(): ExecutionRunRecord[] {
    // Full JSONL implementation would require reading and parsing file
    return []
  }

  /**
   * Append a phase result
   */
  appendPhaseResult(runId: string, result: PhaseResultRecord): void {
    if (this.db) {
      this.appendPhaseResultSQLite(runId, result)
    } else {
      this.appendPhaseResultJSONL(runId, result)
    }
  }

  /**
   * Append phase result to SQLite
   */
  private appendPhaseResultSQLite(
    runId: string,
    result: PhaseResultRecord,
  ): void {
    if (!this.db) {
      throw new Error('Database not initialized')
    }

    const stmt = this.db.prepare(`
      INSERT INTO phase_results (
        run_id, sequence, phase, status, output, error, started_at, completed_at, duration
      ) VALUES (
        @run_id, @sequence, @phase, @status, @output, @error, @started_at, @completed_at, @duration
      )
    `)

    stmt.run({
      run_id: runId,
      sequence: result.sequence,
      phase: result.phase,
      status: result.status,
      output: result.output ? JSON.stringify(result.output) : null,
      error: result.error ? JSON.stringify(result.error) : null,
      started_at: result.startedAt,
      completed_at: result.completedAt,
      duration: result.duration,
    })
  }

  /**
   * Append phase result to JSONL
   */
  private appendPhaseResultJSONL(
    runId: string,
    result: PhaseResultRecord,
  ): void {
    const entry = JSON.stringify({
      type: 'phase_result',
      data: { ...result, runId },
    })
    this.jsonlBuffer.push(entry)
    this.flushJSONL()
  }

  /**
   * Update run status
   */
  updateRunStatus(runId: string, status: RunStatus): void {
    if (this.db) {
      this.updateRunStatusSQLite(runId, status)
    }
    // JSONL would require rewriting the file — handled at app level
  }

  /**
   * Update run status in SQLite
   */
  private updateRunStatusSQLite(runId: string, status: RunStatus): void {
    if (!this.db) {
      throw new Error('Database not initialized')
    }

    const stmt = this.db.prepare(`
      UPDATE runs
      SET status = @status, updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `)

    stmt.run({ id: runId, status })
  }

  /**
   * Ensure all changes are persisted (checkpoint)
   */
  checkpoint(runId: string): void {
    if (this.db) {
      if (!this.getRunSQLite(runId)) {
        throw new Error(`Checkpoint failed: run ${runId} not found`)
      }
      return
    }
    this.flushJSONL()
  }

  /**
   * Flush JSONL buffer to disk synchronously to guarantee persistence
   */
  private flushJSONL(): void {
    if (!this.jsonlPath || this.jsonlBuffer.length === 0) {
      return
    }

    const content = this.jsonlBuffer.join('\n') + '\n'
    this.jsonlBuffer = []

    // Sync write — a persistence layer can't fire-and-forget
    appendFileSync(this.jsonlPath, content)
  }

  /**
   * Close the store (cleanup resources)
   */
  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }

  /**
   * Get all phase results for a run
   */
  getPhaseResults(runId: string): PhaseResultRecord[] {
    if (this.db) {
      return this.getPhaseResultsSQLite(runId)
    }
    return []
  }

  /**
   * Convert a phase_results row to a PhaseResultRecord
   */
  private rowToPhaseResult(row: Record<string, unknown>): PhaseResultRecord {
    return {
      runId: row.run_id as string,
      sequence: row.sequence as number,
      phase: row.phase as PhaseName,
      status: row.status as PhaseResult['status'],
      output: row.output ? JSON.parse(row.output as string) : undefined,
      error: row.error ? JSON.parse(row.error as string) : undefined,
      startedAt: row.started_at as string,
      completedAt: (row.completed_at ?? undefined) as string | undefined,
      duration: (row.duration ?? undefined) as number | undefined,
    }
  }

  /**
   * Get phase results from SQLite
   */
  private getPhaseResultsSQLite(runId: string): PhaseResultRecord[] {
    if (!this.db) {
      throw new Error('Database not initialized')
    }

    const stmt = this.db.prepare(`
      SELECT * FROM phase_results
      WHERE run_id = ?
      ORDER BY sequence ASC
    `)

    const rows = stmt.all(runId) as Record<string, unknown>[]
    return rows.map((row) => this.rowToPhaseResult(row))
  }
}

export default ExecutionStore
