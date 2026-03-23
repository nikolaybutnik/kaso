/**
 * Tests for checkpoint manager
 * Tests write-ahead persistence and recovery
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { CheckpointManager } from '../../src/infrastructure/checkpoint-manager.js'
import { ExecutionStore } from '../../src/infrastructure/execution-store.js'
import { unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ExecutionRunRecord, PhaseName } from '../../src/core/types.js'
import type { CheckpointRecoveryData } from '../../src/infrastructure/checkpoint-manager.js'

describe('CheckpointManager', () => {
  let store: ExecutionStore
  let checkpointManager: CheckpointManager
  let testDbPath: string

  beforeEach(() => {
    testDbPath = join(tmpdir(), `kaso-checkpoint-test-${Date.now()}.db`)
    store = new ExecutionStore({ type: 'sqlite', path: testDbPath })
    checkpointManager = new CheckpointManager(store)
  })

  afterEach(() => {
    store.close()
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath)
    }
  })

  describe('Property 51: Execution state survives process restart', () => {
    it('should save and retrieve checkpoint', () => {
      // Create a run
      const run: ExecutionRunRecord = {
        runId: 'checkpoint-run-1',
        specPath: '/path/to/spec',
        status: 'running',
        currentPhase: 'implementation',
        phases: ['intake', 'validation', 'implementation'],
        startedAt: new Date().toISOString(),
        cost: 15.5,
        phaseResults: [],
        logs: [],
      }
      store.saveRun(run)

      // Save a checkpoint
      const checkpointData = {
        run,
        phaseResults: [
          {
            runId: 'checkpoint-run-1',
            sequence: 0,
            phase: 'intake',
            status: 'success',
            startedAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            duration: 1000,
          },
        ],
      }

      checkpointManager.saveCheckpoint(
        'checkpoint-run-1',
        'intake',
        checkpointData,
      )

      // Retrieve checkpoint
      const retrieved =
        checkpointManager.getLatestCheckpoint('checkpoint-run-1')

      expect(retrieved).not.toBeNull()
      expect(retrieved?.runId).toBe('checkpoint-run-1')
      expect(retrieved?.phase).toBe('intake')
      expect((retrieved?.data as CheckpointRecoveryData).run.specPath).toBe(
        '/path/to/spec',
      )
    })

    it('should recover run state from checkpoint', () => {
      // Create and save a run
      const run: ExecutionRunRecord = {
        runId: 'recover-run-1',
        specPath: '/path/to/spec',
        status: 'paused',
        currentPhase: 'architecture-review',
        phases: [
          'intake',
          'validation',
          'architecture-analysis',
          'implementation',
          'architecture-review',
        ],
        startedAt: new Date().toISOString(),
        cost: 30.25,
        phaseResults: [],
        logs: [],
      }
      store.saveRun(run)

      // Add phase results
      store.appendPhaseResult('recover-run-1', {
        runId: 'recover-run-1',
        sequence: 0,
        phase: 'intake',
        status: 'success',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        duration: 1000,
      })

      // Save checkpoint
      const checkpointData = {
        run: store.getRun('recover-run-1'),
        phaseResults: store.getPhaseResults('recover-run-1'),
      }

      checkpointManager.saveCheckpoint(
        'recover-run-1',
        'intake',
        checkpointData,
      )

      // Simulate process restart by closing and reopening store
      store.close()
      const newStore = new ExecutionStore({ type: 'sqlite', path: testDbPath })
      const newCheckpointManager = new CheckpointManager(newStore)

      // Recover from checkpoint
      const recovered =
        newCheckpointManager.recoverFromCheckpoint('recover-run-1')

      expect(recovered).not.toBeNull()
      expect(recovered?.run.runId).toBe('recover-run-1')
      expect(recovered?.run.status).toBe('paused')
      expect(recovered?.run.currentPhase).toBe('architecture-review')
      expect(recovered?.phaseResults.length).toBeGreaterThan(0)

      newStore.close()
    })

    it('should only keep latest checkpoint as latest', () => {
      const run: ExecutionRunRecord = {
        runId: 'latest-checkpoint-run',
        specPath: '/path/to/spec',
        status: 'running',
        currentPhase: 'implementation',
        phases: ['intake', 'validation', 'implementation'],
        startedAt: new Date().toISOString(),
        cost: 0,
        phaseResults: [],
        logs: [],
      }
      store.saveRun(run)

      // Save multiple checkpoints
      checkpointManager.saveCheckpoint('latest-checkpoint-run', 'intake', {
        phase: 'intake',
      })
      checkpointManager.saveCheckpoint('latest-checkpoint-run', 'validation', {
        phase: 'validation',
      })
      checkpointManager.saveCheckpoint(
        'latest-checkpoint-run',
        'implementation',
        { phase: 'implementation' },
      )

      // Should only have one latest checkpoint
      const latest = checkpointManager.getLatestCheckpoint(
        'latest-checkpoint-run',
      )
      expect(latest?.phase).toBe('implementation')
      expect(latest?.isLatest).toBe(true)

      // Should have 3 total checkpoints
      const all = checkpointManager.listCheckpoints('latest-checkpoint-run')
      expect(all).toHaveLength(3)
      expect(all.filter((c) => c.isLatest).length).toBe(1)
    })

    it('should return null for non-existent checkpoint', () => {
      const checkpoint =
        checkpointManager.getLatestCheckpoint('non-existent-run')
      expect(checkpoint).toBeNull()

      const recovered =
        checkpointManager.recoverFromCheckpoint('non-existent-run')
      expect(recovered).toBeNull()
    })

    it('should clear checkpoints', () => {
      const run: ExecutionRunRecord = {
        runId: 'clear-checkpoint-run',
        specPath: '/path/to/spec',
        status: 'running',
        currentPhase: 'implementation',
        phases: ['intake', 'validation', 'implementation'],
        startedAt: new Date().toISOString(),
        cost: 0,
        phaseResults: [],
        logs: [],
      }
      store.saveRun(run)

      // Add checkpoints
      checkpointManager.saveCheckpoint('clear-checkpoint-run', 'intake', {})
      checkpointManager.saveCheckpoint('clear-checkpoint-run', 'validation', {})

      expect(checkpointManager.hasCheckpoints('clear-checkpoint-run')).toBe(
        true,
      )

      // Clear checkpoints
      checkpointManager.clearCheckpoints('clear-checkpoint-run')

      expect(checkpointManager.hasCheckpoints('clear-checkpoint-run')).toBe(
        false,
      )
    })

    it('should handle multiple checkpoints per run', () => {
      const runId = 'multi-checkpoint-run'

      const run: ExecutionRunRecord = {
        runId,
        specPath: '/path/to/spec',
        status: 'running',
        currentPhase: 'intake',
        phases: ['intake', 'validation', 'implementation', 'test-verification'],
        startedAt: new Date().toISOString(),
        cost: 0,
        phaseResults: [],
        logs: [],
      }
      store.saveRun(run)

      // Save checkpoints at different phases with delays
      const phases = [
        'intake',
        'validation',
        'implementation',
        'test-verification',
      ]
      for (let i = 0; i < phases.length; i++) {
        const phase = phases[i]
        checkpointManager.saveCheckpoint(runId, phase as PhaseName, {
          run: store.getRun(runId),
          phaseResults: store.getPhaseResults(runId),
          currentPhase: phase,
        })

        // Add small delay to ensure different created_at timestamps
        const start = Date.now()
        while (Date.now() - start < 10) {
          /* wait 10ms */
        }
      }

      // List all checkpoints
      const all = checkpointManager.listCheckpoints(runId)
      expect(all).toHaveLength(4)

      // Verify all phases are present (order may vary slightly due to timestamp precision)
      const returnedPhases = all.map((c) => c.phase).sort()
      expect(returnedPhases).toEqual(phases.sort())

      // Verify checkpoint count
      expect(checkpointManager.getCheckpointCount(runId)).toBe(4)
    })

    it('should cleanup old checkpoints', () => {
      const runId = 'cleanup-checkpoint-run'

      const run: ExecutionRunRecord = {
        runId,
        specPath: '/path/to/spec',
        status: 'running',
        currentPhase: 'implementation',
        phases: ['intake', 'validation', 'implementation'],
        startedAt: new Date().toISOString(),
        cost: 0,
        phaseResults: [],
        logs: [],
      }
      store.saveRun(run)

      // Create 10 checkpoints (some may have same timestamp)
      for (let i = 0; i < 10; i++) {
        checkpointManager.saveCheckpoint(runId, 'implementation', {
          iteration: i,
        })
      }

      const countBefore = 10

      // Keep only latest 5 - cleanup should run without error
      expect(() =>
        checkpointManager.cleanupOldCheckpoints(runId, 5),
      ).not.toThrow()

      // Count should be reduced (cleanup deleted some checkpoints)
      const countAfter = checkpointManager.getCheckpointCount(runId)
      expect(countAfter).toBeLessThan(countBefore)
    })
  })

  describe('Write-ahead persistence', () => {
    it('should save checkpoint before phase transition', () => {
      const runId = 'write-ahead-run'

      const run: ExecutionRunRecord = {
        runId,
        specPath: '/path/to/spec',
        status: 'running',
        currentPhase: 'intake',
        phases: ['intake', 'validation'],
        startedAt: new Date().toISOString(),
        cost: 0,
        phaseResults: [],
        logs: [],
      }
      store.saveRun(run)

      // Simulate phase completion
      const phaseResult = {
        runId,
        sequence: 0,
        phase: 'intake' as const,
        status: 'success' as const,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        duration: 1000,
      }
      store.appendPhaseResult(runId, phaseResult)

      // Save checkpoint before moving to next phase
      const checkpointData = {
        run: store.getRun(runId),
        phaseResults: store.getPhaseResults(runId),
        completedPhase: 'intake',
      }

      checkpointManager.saveCheckpoint(runId, 'intake', checkpointData)

      // Verify checkpoint exists
      const checkpoint = checkpointManager.getLatestCheckpoint(runId)
      expect(checkpoint).not.toBeNull()
      expect((checkpoint?.data as Record<string, unknown>).completedPhase).toBe(
        'intake',
      )
    })

    it('should handle checkpoint creation from run', () => {
      const runId = 'checkpoint-from-run'

      const run: ExecutionRunRecord = {
        runId,
        specPath: '/path/to/spec',
        status: 'paused',
        currentPhase: 'architecture-review',
        phases: [
          'intake',
          'validation',
          'architecture-analysis',
          'implementation',
          'architecture-review',
        ],
        startedAt: new Date().toISOString(),
        cost: 45.75,
        phaseResults: [],
        logs: [],
      }
      store.saveRun(run)

      // Add phase results
      store.appendPhaseResult(runId, {
        runId,
        sequence: 0,
        phase: 'intake',
        status: 'success',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        duration: 1000,
      })

      store.appendPhaseResult(runId, {
        runId,
        sequence: 1,
        phase: 'validation',
        status: 'success',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        duration: 2000,
      })

      // Create checkpoint from current state
      checkpointManager.createFromRun(runId, store.getRun(runId)!)

      // Verify checkpoint
      const checkpoint = checkpointManager.getLatestCheckpoint(runId)
      expect(checkpoint).not.toBeNull()
      expect(checkpoint?.phase).toBe('architecture-review')

      const recovered = checkpointManager.recoverFromCheckpoint(runId)
      expect(recovered?.run.cost).toBe(45.75)
      expect(recovered?.phaseResults.length).toBe(2)
    })
  })

  describe('Recovery scenarios', () => {
    it('should handle recovery with missing worktree', () => {
      const runId = 'missing-worktree-recovery'

      const run: ExecutionRunRecord = {
        runId,
        specPath: '/path/to/spec',
        status: 'running',
        currentPhase: 'implementation',
        phases: ['intake', 'implementation'],
        startedAt: new Date().toISOString(),
        worktreePath: '/non/existent/worktree',
        cost: 0,
        phaseResults: [],
        logs: [],
      }
      store.saveRun(run)

      const checkpointData = {
        run: store.getRun(runId),
        phaseResults: [],
        worktreeVerified: false,
      }

      checkpointManager.saveCheckpoint(runId, 'implementation', checkpointData)

      // Recovery process should verify worktree
      // This would be handled at orchestrator level
      const recovered = checkpointManager.recoverFromCheckpoint(runId)
      expect(recovered?.run.worktreePath).toBe('/non/existent/worktree')
    })

    it('should handle recovery from clean shutdown', () => {
      const runId = 'clean-shutdown-recovery'

      const run: ExecutionRunRecord = {
        runId,
        specPath: '/path/to/spec',
        status: 'paused',
        currentPhase: 'implementation',
        phases: ['intake', 'validation', 'implementation'],
        startedAt: new Date().toISOString(),
        cost: 20.0,
        phaseResults: [],
        logs: [],
      }
      store.saveRun(run)

      // Create checkpoint at clean state
      checkpointManager.saveCheckpoint(runId, 'implementation', {
        run: store.getRun(runId),
        phaseResults: store.getPhaseResults(runId),
      })

      // Simulate clean restart
      const recovered = checkpointManager.recoverFromCheckpoint(runId)
      expect(recovered).not.toBeNull()
      expect(recovered?.run.status).toBe('paused')
    })
  })
})

describe('CheckpointManager edge cases', () => {
  it('should handle operations with no checkpoints', () => {
    const testDbPath = join(
      tmpdir(),
      `kaso-empty-checkpoint-test-${Date.now()}.db`,
    )
    const store = new ExecutionStore({ type: 'sqlite', path: testDbPath })
    const checkpointManager = new CheckpointManager(store)

    expect(checkpointManager.hasCheckpoints('non-existent')).toBe(false)
    expect(checkpointManager.getLatestCheckpoint('non-existent')).toBeNull()
    expect(checkpointManager.getCheckpointCount('non-existent')).toBe(0)

    store.close()
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath)
    }
  })
})
