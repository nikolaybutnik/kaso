/**
 * File Watcher for KASO
 * Monitors .kiro/specs/ directories for file changes and triggers orchestration
 *
 * Requirements: 2.1, 2.2
 */

import chokidar, { FSWatcher } from 'chokidar'
import { promises as fs } from 'fs'
import { join, dirname, basename } from 'path'
import { EventBus } from '@/core/event-bus'
import type { EventType } from '@/core/types'
import type { SpecStatus } from '@/infrastructure/spec-writer'

/**
 * Callback function type for spec readiness detection
 */
export type SpecReadyCallback = (
  specPath: string,
  specName: string,
) => void | Promise<void>

/**
 * File watcher configuration
 */
export interface FileWatcherConfig {
  /** Root directory to watch (default: .kiro/specs) */
  specsDir: string
  /** File patterns to watch */
  watchPatterns: string[]
  /** Ignore patterns */
  ignorePatterns: string[]
  /** Polling interval for file changes (ms) */
  pollingInterval: number
  /** Enable polling (useful for network filesystems) */
  usePolling: boolean
}

/**
 * File watcher state
 */
export type FileWatcherState = 'idle' | 'watching' | 'stopped' | 'error'

/**
 * FileWatcher - Monitors spec directories for status changes
 *
 * Watches status.json files in spec directories for transitions to ready-for-dev state
 * and triggers the orchestrator to start a new run.
 */
export class FileWatcher {
  private readonly config: FileWatcherConfig
  private readonly eventBus: EventBus
  private watcher: FSWatcher | null = null
  private state: FileWatcherState = 'idle'
  private readyCallback: SpecReadyCallback | null = null
  private readonly seenSpecs: Set<string> = new Set()

  constructor(config: Partial<FileWatcherConfig> = {}, eventBus?: EventBus) {
    this.config = {
      specsDir: config.specsDir ?? '.kiro/specs',
      watchPatterns: config.watchPatterns ?? ['**/status.json'],
      ignorePatterns: config.ignorePatterns ?? [
        '**/node_modules/**',
        '**/.git/**',
      ],
      pollingInterval: config.pollingInterval ?? 1000,
      usePolling: config.usePolling ?? false,
    }
    this.eventBus = eventBus ?? new EventBus()
  }

  /**
   * Get current watcher state
   */
  getState(): FileWatcherState {
    return this.state
  }

  /**
   * Check if watcher is currently active
   */
  isWatching(): boolean {
    return this.state === 'watching' && this.watcher !== null
  }

  /**
   * Start watching for spec file changes
   * @param onSpecReady Callback invoked when a spec is ready for development
   */
  async start(onSpecReady: SpecReadyCallback): Promise<void> {
    if (this.state === 'watching') {
      throw new Error('File watcher is already running')
    }

    this.readyCallback = onSpecReady
    this.state = 'watching'

    // Handle both absolute and relative paths
    const watchPath = this.config.specsDir.startsWith('/')
      ? this.config.specsDir
      : join(process.cwd(), this.config.specsDir)

    // Ensure specs directory exists
    try {
      await fs.mkdir(watchPath, { recursive: true })
    } catch {
      // Directory might already exist
    }

    // Initialize chokidar watcher
    this.watcher = chokidar.watch(this.config.watchPatterns, {
      cwd: watchPath,
      ignored: this.config.ignorePatterns,
      persistent: true,
      ignoreInitial: false, // Process existing files on start
      usePolling: this.config.usePolling,
      interval: this.config.pollingInterval,
      awaitWriteFinish: {
        stabilityThreshold: 300,
        pollInterval: 100,
      },
    })

    this.setupEventHandlers()

    // Emit started event
    this.emitEvent('watcher:started', { specsDir: watchPath })

    // Wait for initial scan to complete
    await new Promise<void>((resolve) => {
      this.watcher?.once('ready', () => {
        this.emitEvent('watcher:ready', { specsDir: watchPath })
        resolve()
      })
    })
  }

  /**
   * Stop watching for file changes
   */
  async stop(): Promise<void> {
    if (this.watcher) {
      await this.watcher.close()
      this.watcher = null
    }

    this.state = 'stopped'
    this.seenSpecs.clear()
    this.emitEvent('watcher:stopped', {})
  }

  /**
   * Get list of specs currently being watched
   */
  getWatchedSpecs(): string[] {
    if (!this.watcher) {
      return []
    }

    const watched = this.watcher.getWatched()
    const specs: string[] = []
    const basePath = this.config.specsDir.startsWith('/')
      ? this.config.specsDir
      : join(process.cwd(), this.config.specsDir)

    for (const [dir, files] of Object.entries(watched)) {
      for (const file of files) {
        if (file === 'status.json') {
          const specPath = join(basePath, dir)
          specs.push(specPath)
        }
      }
    }

    return specs
  }

  /**
   * Manually check a spec directory for readiness
   * Useful for initial scan or testing
   */
  async checkSpecStatus(specPath: string): Promise<boolean> {
    try {
      const status = await this.readStatusFile(specPath)
      return this.isSpecReady(status)
    } catch {
      return false
    }
  }

  /**
   * Force trigger a spec ready check (for testing or manual triggering)
   */
  async triggerSpecCheck(specPath: string): Promise<void> {
    if (!this.readyCallback) {
      throw new Error('No callback registered. Call start() first.')
    }

    const status = await this.readStatusFile(specPath)
    if (this.isSpecReady(status)) {
      const specName = this.extractSpecName(specPath)
      await this.invokeCallback(specPath, specName)
    }
  }

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  private setupEventHandlers(): void {
    if (!this.watcher) return

    // File added
    this.watcher.on('add', (filePath: string) => {
      this.handleFileChange(filePath, 'added')
    })

    // File changed
    this.watcher.on('change', (filePath: string) => {
      this.handleFileChange(filePath, 'changed')
    })

    // File removed
    this.watcher.on('unlink', (filePath: string) => {
      this.handleFileRemoved(filePath)
    })

    // Error handler
    this.watcher.on('error', (error: Error) => {
      this.state = 'error'
      this.emitEvent('watcher:error', {
        error: error.message,
      })
    })
  }

  private async handleFileChange(
    filePath: string,
    changeType: 'added' | 'changed',
  ): Promise<void> {
    // Only process status.json files
    if (basename(filePath) !== 'status.json') {
      return
    }

    const specDir = dirname(filePath)
    const basePath = this.config.specsDir.startsWith('/')
      ? this.config.specsDir
      : join(process.cwd(), this.config.specsDir)
    const specPath = join(basePath, specDir)
    const specName = this.extractSpecName(specPath)

    try {
      const status = await this.readStatusFile(specPath)

      this.emitEvent('watcher:status:detected', {
        specPath,
        specName,
        status,
        changeType,
      })

      // Check if spec is ready for development
      if (this.isSpecReady(status)) {
        // Avoid duplicate triggers for the same spec
        if (!this.seenSpecs.has(specPath)) {
          this.seenSpecs.add(specPath)
          this.emitEvent('watcher:spec:ready', {
            specPath,
            specName,
            status,
          })
          await this.invokeCallback(specPath, specName)
        }
      } else {
        // Reset seen status if spec is no longer ready
        this.seenSpecs.delete(specPath)
      }
    } catch (error) {
      this.emitEvent('watcher:error', {
        specPath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private handleFileRemoved(filePath: string): void {
    if (basename(filePath) !== 'status.json') {
      return
    }

    const specDir = dirname(filePath)
    const basePath = this.config.specsDir.startsWith('/')
      ? this.config.specsDir
      : join(process.cwd(), this.config.specsDir)
    const specPath = join(basePath, specDir)

    this.seenSpecs.delete(specPath)

    this.emitEvent('watcher:status:removed', {
      specPath,
    })
  }

  // ---------------------------------------------------------------------------
  // File operations
  // ---------------------------------------------------------------------------

  private async readStatusFile(specPath: string): Promise<SpecStatus | null> {
    const statusFilePath = join(specPath, 'status.json')

    try {
      const content = await fs.readFile(statusFilePath, 'utf-8')
      return JSON.parse(content) as SpecStatus
    } catch {
      return null
    }
  }

  // ---------------------------------------------------------------------------
  // Spec readiness detection
  // ---------------------------------------------------------------------------

  /**
   * Check if a spec status indicates it's ready for development
   * "ready-for-dev" means runStatus is 'pending' and no active run
   */
  private isSpecReady(status: SpecStatus | null): boolean {
    if (!status) {
      return false
    }

    // Spec is ready when:
    // 1. runStatus is 'pending' (waiting to start)
    // 2. No currentPhase is set (not currently running)
    return status.runStatus === 'pending' && !status.currentPhase
  }

  private extractSpecName(specPath: string): string {
    return basename(specPath)
  }

  // ---------------------------------------------------------------------------
  // Callback invocation
  // ---------------------------------------------------------------------------

  private async invokeCallback(
    specPath: string,
    specName: string,
  ): Promise<void> {
    if (!this.readyCallback) {
      return
    }

    try {
      const result = this.readyCallback(specPath, specName)
      if (result instanceof Promise) {
        await result
      }
    } catch (error) {
      this.emitEvent('watcher:callback:error', {
        specPath,
        specName,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  // ---------------------------------------------------------------------------
  // Event emission
  // ---------------------------------------------------------------------------

  private emitEvent(type: string, data: Record<string, unknown>): void {
    this.eventBus.emit({
      type: type as EventType,
      runId: 'file-watcher',
      timestamp: new Date().toISOString(),
      data,
    })
  }
}

// =============================================================================
// Factory function
// =============================================================================

/**
 * Create a new FileWatcher instance
 */
export function createFileWatcher(
  config?: Partial<FileWatcherConfig>,
  eventBus?: EventBus,
): FileWatcher {
  return new FileWatcher(config, eventBus)
}
