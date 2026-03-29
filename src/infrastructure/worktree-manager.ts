import { SimpleGit, simpleGit } from 'simple-git'
import { join } from 'path'
import { mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'fs'
import { WorktreeInfo } from '@/core/types'

/**
 * Manages git worktree lifecycle for isolated execution
 * All file modifications happen in worktrees, never in main directory
 */
export class WorktreeManager {
  private git: SimpleGit
  private worktrees: Map<string, WorktreeInfo & { retained: boolean }>
  private readonly worktreesDir: string

  constructor(workingDir: string = process.cwd()) {
    this.git = simpleGit(workingDir)
    this.worktrees = new Map()
    this.worktreesDir = join(workingDir, '.kaso', 'worktrees')

    // Ensure worktrees directory exists
    if (!existsSync(this.worktreesDir)) {
      mkdirSync(this.worktreesDir, { recursive: true })
    }
  }

  /**
   * Create a new git worktree for a run
   * Branch name format: kaso/[specName]-[YYYYMMDDTHHmmss]
   *
   * Retries automatically on transient git lock errors that occur when
   * multiple worktree operations run concurrently.
   */
  async create(specName: string, baseBranch: string): Promise<WorktreeInfo> {
    const MAX_LOCK_RETRIES = 4
    const BASE_DELAY_MS = 300

    for (let attempt = 0; attempt <= MAX_LOCK_RETRIES; attempt++) {
      try {
        return await this.createWorktree(specName, baseBranch)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        const isGitLock =
          msg.includes('could not lock') || msg.includes('File exists')
        if (!isGitLock || attempt === MAX_LOCK_RETRIES) {
          throw error
        }
        const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 200
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
    // Unreachable — the loop always throws or returns
    throw new Error('WorktreeManager.create: unreachable')
  }

  /**
   * Internal: single-attempt worktree creation
   */
  private async createWorktree(
    specName: string,
    baseBranch: string,
  ): Promise<WorktreeInfo> {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:\-]/g, '')
      .replace(/\.\d{3}Z$/, '')
    const branchName = `kaso/${specName}-${timestamp}`
    const runId = `${specName}-${timestamp}`
    const worktreePath = join(this.worktreesDir, runId)

    // Check if worktree already exists
    if (existsSync(worktreePath)) {
      throw new Error(
        `Worktree already exists for run ${runId} at ${worktreePath}`,
      )
    }

    try {
      // Create worktree using simple-git
      await this.git.raw([
        'worktree',
        'add',
        '-b',
        branchName,
        worktreePath,
        baseBranch,
      ])

      // Initialize worktree git instance
      const worktreeGit = simpleGit(worktreePath)

      // Configure worktree to track remote
      await worktreeGit.raw([
        'branch',
        '--set-upstream-to',
        `origin/${baseBranch}`,
        branchName,
      ])

      const worktreeInfo: WorktreeInfo = {
        path: worktreePath,
        branch: branchName,
        runId,
      }

      // Store worktree metadata
      this.worktrees.set(runId, { ...worktreeInfo, retained: false })

      return worktreeInfo
    } catch (error) {
      // Cleanup on failure
      if (existsSync(worktreePath)) {
        const worktreeGit = simpleGit(worktreePath)
        try {
          await worktreeGit.raw(['worktree', 'remove', worktreePath])
        } catch {
          // Ignore cleanup errors
        }
      }
      throw new Error(
        `Failed to create worktree: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Get the path of a worktree for a run
   */
  getPath(runId: string): string {
    const worktree = this.worktrees.get(runId)
    if (!worktree) {
      const path = join(this.worktreesDir, runId)
      if (existsSync(path)) {
        return path
      }
      throw new Error(`Worktree not found for run ${runId}`)
    }
    return worktree.path
  }

  /**
   * Get worktree info for a run
   */
  getWorktreeInfo(runId: string): WorktreeInfo | undefined {
    const worktree = this.worktrees.get(runId)
    if (!worktree) {
      return undefined
    }
    return {
      path: worktree.path,
      branch: worktree.branch,
      runId: worktree.runId,
    }
  }

  /**
   * Get worktree info for a run, checking disk if not in memory
   */
  async getWorktreeInfoFromDisk(
    runId: string,
  ): Promise<WorktreeInfo | undefined> {
    // Check memory first
    const worktree = this.worktrees.get(runId)
    if (worktree) {
      return {
        path: worktree.path,
        branch: worktree.branch,
        runId: worktree.runId,
      }
    }

    // Try to find it on disk
    const path = join(this.worktreesDir, runId)
    if (existsSync(path)) {
      // Extract branch name from git
      const worktreeGit = simpleGit(path)
      try {
        const branchSummary = await worktreeGit.branch()
        const currentBranch = branchSummary.current
        if (currentBranch && currentBranch.startsWith('kaso/')) {
          const worktreeInfo: WorktreeInfo = {
            path,
            branch: currentBranch,
            runId,
          }
          this.worktrees.set(runId, { ...worktreeInfo, retained: false })
          return worktreeInfo
        }
      } catch {
        // Ignore git errors
      }
    }
    return undefined
  }

  /**
   * Push worktree branch to remote
   */
  async push(runId: string, remote: string = 'origin'): Promise<void> {
    const worktree = this.worktrees.get(runId)
    if (!worktree) {
      throw new Error(`Worktree not found for run ${runId}`)
    }

    if (!existsSync(worktree.path)) {
      throw new Error(`Worktree path does not exist: ${worktree.path}`)
    }

    const worktreeGit = simpleGit(worktree.path)

    try {
      // Push to remote
      await worktreeGit.push(remote, worktree.branch)
    } catch (error) {
      throw new Error(
        `Failed to push worktree ${runId}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Clean up a worktree
   * If retain() was called and force is false, the worktree is kept
   */
  async cleanup(runId: string, force = false): Promise<void> {
    const worktree = this.worktrees.get(runId)
    if (!worktree) {
      throw new Error(`Worktree not found for run ${runId}`)
    }

    // If marked for retention and not forced, don't delete
    if (worktree.retained && !force) {
      return
    }

    if (!existsSync(worktree.path)) {
      this.worktrees.delete(runId)
      return
    }

    const branchToDelete = worktree.branch

    try {
      // Remove worktree using git (--force handles dirty worktrees)
      await this.git.raw(['worktree', 'remove', '--force', worktree.path])
    } catch (error) {
      // If git remove fails, try manual directory removal as fallback
      try {
        rmSync(worktree.path, { recursive: true, force: true })
        // Prune stale worktree references so git knows it's gone
        await this.git.raw(['worktree', 'prune'])
      } catch (manualError) {
        throw new Error(
          `Failed to cleanup worktree ${runId}: ${error instanceof Error ? error.message : String(error)}`,
        )
      }
    }

    // Always delete the branch after removing the worktree
    try {
      await this.git.raw(['branch', '-D', branchToDelete])
    } catch {
      // Branch may already be gone — that's fine
    }

    this.worktrees.delete(runId)
  }

  /**
   * Mark a worktree to be retained (not auto-cleaned up)
   */
  retain(runId: string): void {
    const worktree = this.worktrees.get(runId)
    if (!worktree) {
      // Check if it exists on disk
      const path = join(this.worktreesDir, runId)
      if (existsSync(path)) {
        // Try to recover metadata
        const worktreeGit = simpleGit(path)
        worktreeGit
          .branch()
          .then((branchSummary) => {
            const currentBranch = branchSummary.current
            if (currentBranch && currentBranch.startsWith('kaso/')) {
              this.worktrees.set(runId, {
                path,
                branch: currentBranch,
                runId,
                retained: true,
              })
            }
          })
          .catch(() => {
            // If we can't get branch info, still mark as retained
            this.worktrees.set(runId, {
              path,
              branch: 'unknown',
              runId,
              retained: true,
            })
          })
      } else {
        throw new Error(`Worktree not found for run ${runId}`)
      }
    } else {
      worktree.retained = true
    }
  }

  /**
   * Check if a worktree exists
   */
  exists(runId: string): boolean {
    const worktree = this.worktrees.get(runId)
    if (worktree) {
      return existsSync(worktree.path)
    }

    const path = join(this.worktreesDir, runId)
    return existsSync(path)
  }

  /**
   * Verify worktree git state is valid and consistent
   */
  async isConsistent(runId: string): Promise<boolean> {
    const worktree = this.worktrees.get(runId)
    if (!worktree || !existsSync(worktree.path)) {
      return false
    }

    try {
      const worktreeGit = simpleGit(worktree.path)

      // Check if it's a valid git repository
      const isRepo = await worktreeGit.checkIsRepo()
      if (!isRepo) {
        return false
      }

      // Check if the branch matches expected
      const branchSummary = await worktreeGit.branch()
      if (branchSummary.current !== worktree.branch) {
        return false
      }

      // Check if there are no uncommitted changes
      const status = await worktreeGit.status()
      if (!status.isClean()) {
        return false
      }

      return true
    } catch {
      return false
    }
  }

  /**
   * List all worktrees managed by this manager
   */
  listWorktrees(): WorktreeInfo[] {
    return Array.from(this.worktrees.values()).map((w) => ({
      path: w.path,
      branch: w.branch,
      runId: w.runId,
    }))
  }

  /**
   * Load existing worktrees from disk (for crash recovery)
   */
  async loadExistingWorktrees(): Promise<number> {
    if (!existsSync(this.worktreesDir)) {
      return 0
    }

    let loaded = 0
    const entries = readdirSync(this.worktreesDir)

    for (const entry of entries) {
      const worktreePath = join(this.worktreesDir, entry)

      // Skip if not a directory (entry may have been removed by concurrent cleanup)
      try {
        if (!statSync(worktreePath).isDirectory()) {
          continue
        }
      } catch {
        continue
      }

      try {
        const worktreeGit = simpleGit(worktreePath)
        const isRepo = await worktreeGit.checkIsRepo()
        if (!isRepo) {
          continue
        }

        const branchSummary = await worktreeGit.branch()
        const currentBranch = branchSummary.current

        // Only load worktrees with kaso branches
        if (currentBranch && currentBranch.startsWith('kaso/')) {
          this.worktrees.set(entry, {
            path: worktreePath,
            branch: currentBranch,
            runId: entry,
            retained: false,
          })
          loaded++
        }
      } catch {
        // Ignore errors for this worktree
        continue
      }
    }

    return loaded
  }
}
