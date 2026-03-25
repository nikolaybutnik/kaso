/**
 * Tests for execution store
 * Tests Property 39: Execution history round-trip
 * Tests Property 51: Execution state survives process restart
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import { ExecutionStore } from '@/infrastructure/execution-store'
import { unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ExecutionRunRecord, PhaseResultRecord } from '@/core/types'

describe('ExecutionStore', () => {
  let store: ExecutionStore
  let testDbPath: string

  beforeEach(() => {
    testDbPath = join(tmpdir(), `kaso-test-${Date.now()}.db`)
    store = new ExecutionStore({ type: 'sqlite', path: testDbPath })
  })

  afterEach(() => {
    store.close()
    if (existsSync(testDbPath)) {
      unlinkSync(testDbPath)
    }
  })

  describe('Property 39: Execution history round-trip', () => {
    it('should save and retrieve a run record', () => {
      const run: ExecutionRunRecord = {
        runId: 'test-run-1',
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
      const retrieved = store.getRun('test-run-1')

      expect(retrieved).not.toBeNull()
      expect(retrieved?.runId).toBe(run.runId)
      expect(retrieved?.specPath).toBe(run.specPath)
      expect(retrieved?.status).toBe(run.status)
    })

    it('should handle complex run records with all fields', () => {
      const now = new Date().toISOString()
      const run: ExecutionRunRecord = {
        runId: 'complex-run-1',
        specPath: '/complex/spec/path',
        status: 'paused',
        currentPhase: 'implementation',
        phases: [
          'intake',
          'validation',
          'architecture-analysis',
          'implementation',
        ],
        startedAt: now,
        pausedAt: now,
        completedAt: undefined,
        worktreePath: '/tmp/worktree-123',
        cost: 42.5,
        phaseResults: [],
        logs: [],
      }

      store.saveRun(run)
      const retrieved = store.getRun('complex-run-1')

      expect(retrieved).toEqual(run)
    })

    it('should save and retrieve phase results', () => {
      // Create a run first
      const run: ExecutionRunRecord = {
        runId: 'run-with-phases',
        specPath: '/path/to/spec',
        status: 'running',
        currentPhase: 'intake',
        phases: ['intake'],
        startedAt: new Date().toISOString(),
        cost: 0,
        phaseResults: [],
        logs: [],
      }
      store.saveRun(run)

      // Add phase results
      const phaseResult1: PhaseResultRecord = {
        runId: 'run-with-phases',
        sequence: 0,
        phase: 'intake',
        status: 'success',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        duration: 1000,
      }

      const phaseResult2: PhaseResultRecord = {
        runId: 'run-with-phases',
        sequence: 1,
        phase: 'validation',
        status: 'success',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        duration: 2000,
        output: { approved: true },
      }

      store.appendPhaseResult('run-with-phases', phaseResult1)
      store.appendPhaseResult('run-with-phases', phaseResult2)

      // Retrieve phase results
      const results = store.getPhaseResults('run-with-phases')

      expect(results).toHaveLength(2)
      expect(results[0]?.phase).toBe('intake')
      expect(results[1]?.phase).toBe('validation')
      expect(results[1]?.output).toEqual({ approved: true })
    })

    it('should update run status', () => {
      const run: ExecutionRunRecord = {
        runId: 'status-test-run',
        specPath: '/path/to/spec',
        status: 'running',
        currentPhase: 'intake',
        phases: ['intake'],
        startedAt: new Date().toISOString(),
        cost: 0,
        phaseResults: [],
        logs: [],
      }

      store.saveRun(run)
      store.updateRunStatus('status-test-run', 'completed')

      const retrieved = store.getRun('status-test-run')
      expect(retrieved?.status).toBe('completed')
    })

    it('should list runs with pagination', () => {
      // Create multiple runs with delays to ensure different timestamps
      for (let i = 0; i < 5; i++) {
        const run: ExecutionRunRecord = {
          runId: `list-run-${i}`,
          specPath: `/path/to/spec/${i}`,
          status: 'completed',
          currentPhase: 'review-delivery',
          phases: ['intake', 'validation', 'review-delivery'],
          startedAt: new Date(Date.now() - i * 1000).toISOString(),
          completedAt: new Date().toISOString(),
          cost: i * 10,
          phaseResults: [],
          logs: [],
        }

        // Add small delay to ensure different created_at timestamps
        const start = Date.now()
        while (Date.now() - start < 10) {
          /* wait 10ms */
        }

        store.saveRun(run)
      }

      // List first 3 runs
      const runs = store.listRuns(3, 0)
      expect(runs).toHaveLength(3)

      // Verify we got 3 runs from the first page
      const returnedIds = runs.map((r) => r.runId)
      expect(returnedIds.every((id) => id.startsWith('list-run-'))).toBe(true)
      expect(new Set(returnedIds).size).toBe(3) // All unique
    })
  })

  describe('Property 51: Execution state survives process restart', () => {
    it('should retrieve interrupted runs', () => {
      // Create completed runs
      for (let i = 0; i < 3; i++) {
        const run: ExecutionRunRecord = {
          runId: `completed-run-${i}`,
          specPath: `/path/to/spec/${i}`,
          status: 'completed',
          currentPhase: 'review-delivery',
          phases: ['intake', 'validation', 'review-delivery'],
          startedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          cost: 0,
          phaseResults: [],
          logs: [],
        }
        store.saveRun(run)
      }

      // Create interrupted runs
      const interruptedRuns: ExecutionRunRecord[] = []
      for (let i = 0; i < 2; i++) {
        const run: ExecutionRunRecord = {
          runId: `interrupted-run-${i}`,
          specPath: `/path/to/spec/${i}`,
          status: i === 0 ? 'running' : 'paused',
          currentPhase: 'implementation',
          phases: [
            'intake',
            'validation',
            'architecture-analysis',
            'implementation',
          ],
          startedAt: new Date().toISOString(),
          cost: 0,
          phaseResults: [],
          logs: [],
        }
        store.saveRun(run)
        interruptedRuns.push(run)
      }

      // Get interrupted runs
      const retrieved = store.getInterruptedRuns()

      expect(retrieved).toHaveLength(2)
      expect(
        retrieved.every(
          (run) => run.status === 'running' || run.status === 'paused',
        ),
      ).toBe(true)
    })

    it('should persist state across store instances', () => {
      const run: ExecutionRunRecord = {
        runId: 'persist-test',
        specPath: '/path/to/spec',
        status: 'running',
        currentPhase: 'implementation',
        phases: ['intake', 'validation', 'implementation'],
        startedAt: new Date().toISOString(),
        cost: 25.5,
        phaseResults: [],
        logs: [],
      }

      // Save with first store instance
      store.saveRun(run)
      store.appendPhaseResult('persist-test', {
        runId: 'persist-test',
        sequence: 0,
        phase: 'intake',
        status: 'success',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        duration: 1000,
      })

      // Close first instance
      store.close()

      // Create new instance (simulating process restart)
      const newStore = new ExecutionStore({ type: 'sqlite', path: testDbPath })

      // Should retrieve saved state
      const retrievedRun = newStore.getRun('persist-test')
      expect(retrievedRun).not.toBeNull()
      expect(retrievedRun?.status).toBe('running')
      expect(retrievedRun?.cost).toBe(25.5)

      const retrievedPhases = newStore.getPhaseResults('persist-test')
      expect(retrievedPhases).toHaveLength(1)
      expect(retrievedPhases[0]?.phase).toBe('intake')

      newStore.close()
    })

    it('should handle checkpoint operation', () => {
      const run: ExecutionRunRecord = {
        runId: 'checkpoint-test',
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
      store.checkpoint('checkpoint-test')

      // Should not throw and run should exist
      const retrieved = store.getRun('checkpoint-test')
      expect(retrieved).not.toBeNull()
    })

    it('should maintain data integrity across multiple operations', () => {
      const runId = 'integrity-test'

      // Create run
      const run: ExecutionRunRecord = {
        runId,
        specPath: '/path/to/spec',
        status: 'running',
        currentPhase: 'intake',
        phases: ['intake', 'validation', 'implementation'],
        startedAt: new Date().toISOString(),
        cost: 0,
        phaseResults: [],
        logs: [],
      }
      store.saveRun(run)

      // Add multiple phase results
      for (let i = 0; i < 5; i++) {
        store.appendPhaseResult(runId, {
          runId,
          sequence: i,
          phase: i % 2 === 0 ? 'intake' : 'validation',
          status: 'success',
          startedAt: new Date(Date.now() + i * 1000).toISOString(),
          completedAt: new Date(Date.now() + i * 1000 + 500).toISOString(),
          duration: 500,
        })
      }

      // Update status
      store.updateRunStatus(runId, 'completed')

      // Retrieve and verify
      const retrievedRun = store.getRun(runId)
      expect(retrievedRun?.status).toBe('completed')

      const phases = store.getPhaseResults(runId)
      expect(phases).toHaveLength(5)
      expect(phases.every((p) => p.status === 'success')).toBe(true)
    })
  })

  describe('Edge cases', () => {
    it('should handle empty database', () => {
      const runs = store.listRuns()
      expect(runs).toEqual([])

      const interrupted = store.getInterruptedRuns()
      expect(interrupted).toEqual([])

      const nonExistent = store.getRun('non-existent')
      expect(nonExistent).toBeNull()
    })

    it('should handle phase results with errors', () => {
      const run: ExecutionRunRecord = {
        runId: 'error-phase-run',
        specPath: '/path/to/spec',
        status: 'failed',
        currentPhase: 'implementation',
        phases: ['intake', 'validation', 'implementation'],
        startedAt: new Date().toISOString(),
        cost: 0,
        phaseResults: [],
        logs: [],
      }
      store.saveRun(run)

      const phaseResult: PhaseResultRecord = {
        runId: 'error-phase-run',
        sequence: 0,
        phase: 'implementation',
        status: 'failure',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        duration: 1000,
        error: {
          message: 'Build failed',
          code: 'BUILD_ERROR',
          retryable: false,
        },
      }

      store.appendPhaseResult('error-phase-run', phaseResult)

      const results = store.getPhaseResults('error-phase-run')
      expect(results).toHaveLength(1)
      expect(results[0]?.error?.message).toBe('Build failed')
      expect(results[0]?.error?.code).toBe('BUILD_ERROR')
    })

    it('should handle large payload in phase output', () => {
      const run: ExecutionRunRecord = {
        runId: 'large-payload-run',
        specPath: '/path/to/spec',
        status: 'running',
        currentPhase: 'implementation',
        phases: ['intake', 'implementation'],
        startedAt: new Date().toISOString(),
        cost: 0,
        phaseResults: [],
        logs: [],
      }
      store.saveRun(run)

      // Create a large output object
      const largeOutput = {
        files: Array.from({ length: 100 }, (_, i) => ({
          path: `/path/to/file${i}.ts`,
          changes: Array.from({ length: 50 }, () => 'some code here'),
        })),
      }

      const phaseResult: PhaseResultRecord = {
        runId: 'large-payload-run',
        sequence: 0,
        phase: 'implementation',
        status: 'success',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        duration: 5000,
        output: largeOutput,
      }

      expect(() =>
        store.appendPhaseResult('large-payload-run', phaseResult),
      ).not.toThrow()

      const results = store.getPhaseResults('large-payload-run')
      expect(results[0]?.output?.files).toHaveLength(100)
    })
  })
})

describe('ExecutionStore (JSONL mode)', () => {
  let store: ExecutionStore
  let testFilePath: string

  beforeEach(() => {
    testFilePath = join(tmpdir(), `kaso-test-${Date.now()}.jsonl`)
    store = new ExecutionStore({ type: 'jsonl', path: testFilePath })
  })

  afterEach(() => {
    store.close()
    if (existsSync(testFilePath)) {
      unlinkSync(testFilePath)
    }
  })

  it('should initialize JSONL store', () => {
    expect(store).toBeDefined()
  })

  it('should handle basic operations in JSONL mode', () => {
    const run: ExecutionRunRecord = {
      runId: 'jsonl-test',
      specPath: '/path/to/spec',
      status: 'running',
      currentPhase: 'intake',
      phases: ['intake'],
      startedAt: new Date().toISOString(),
      cost: 0,
      phaseResults: [],
      logs: [],
    }

    // These operations should not throw in JSONL mode
    expect(() => store.saveRun(run)).not.toThrow()
    expect(() => store.checkpoint('jsonl-test')).not.toThrow()
  })
})
