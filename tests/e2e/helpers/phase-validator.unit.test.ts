/**
 * Unit Tests for PhaseValidator Helper
 *
 * Requirements: 3.3, 3.5, 3.6, 4.1–4.8
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { ExecutionStore } from '@/infrastructure/execution-store'
import { PhaseValidator } from './phase-validator'
import type { PhaseResultRecord, ExecutionRunRecord } from '@/core/types'

describe('PhaseValidator', () => {
  let executionStore: ExecutionStore
  let validator: PhaseValidator
  let runId: string

  beforeEach(() => {
    executionStore = new ExecutionStore({ type: 'sqlite', path: ':memory:' })
    validator = new PhaseValidator(executionStore)
    runId = 'test-run-' + Date.now()

    // Create a run record
    const run: ExecutionRunRecord = {
      runId,
      specPath: '/test/spec',
      status: 'completed',
      phases: [],
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      cost: 0.1,
      phaseResults: [],
      logs: [],
    }
    executionStore.saveRun(run)
  })

  function addPhaseResult(
    phase: string,
    sequence: number,
    overrides: Partial<PhaseResultRecord> = {},
  ): void {
    const now = Date.now()
    const result: PhaseResultRecord = {
      runId,
      phase: phase as unknown as PhaseResultRecord['phase'],
      status: 'success',
      sequence,
      startedAt: new Date(now).toISOString(),
      completedAt: new Date(now + 1000).toISOString(),
      duration: 1000,
      output: {},
      ...overrides,
    }
    executionStore.appendPhaseResult(runId, result)
  }

  describe('assertAllPhasesCompleted', () => {
    it('should pass when all 8 phases completed', () => {
      const phases = [
        'intake',
        'validation',
        'architecture-analysis',
        'implementation',
        'architecture-review',
        'test-verification',
        'ui-validation',
        'review-delivery',
      ] as const

      phases.forEach((phase, i) => addPhaseResult(phase, i))

      expect(() => validator.assertAllPhasesCompleted(runId)).not.toThrow()
    })

    it('should throw when less than 8 phases', () => {
      addPhaseResult('intake', 0)
      addPhaseResult('validation', 1)

      expect(() => validator.assertAllPhasesCompleted(runId)).toThrow(
        'Expected 8 phase results',
      )
    })

    it('should throw when a phase failed', () => {
      const phases = [
        'intake',
        'validation',
        'architecture-analysis',
        'implementation',
        'architecture-review',
        'test-verification',
        'ui-validation',
        'review-delivery',
      ] as const

      phases.forEach((phase, i) => {
        addPhaseResult(phase, i, { status: phase === 'validation' ? 'failure' : 'success' })
      })

      expect(() => validator.assertAllPhasesCompleted(runId)).toThrow(
        'incomplete',
      )
    })
  })

  describe('assertSequenceOrder', () => {
    it('should pass when sequence is 0-7', () => {
      addPhaseResult('intake', 0)
      addPhaseResult('validation', 1)
      addPhaseResult('architecture-analysis', 2)

      expect(() => validator.assertSequenceOrder(runId)).not.toThrow()
    })

    it('should throw when sequence is out of order', () => {
      addPhaseResult('intake', 0)
      addPhaseResult('validation', 2) // Skip 1

      expect(() => validator.assertSequenceOrder(runId)).toThrow(
        'Expected sequence 1',
      )
    })
  })

  describe('assertValidTiming', () => {
    it('should pass with valid timing', () => {
      addPhaseResult('intake', 0, {
        duration: 1000,
        startedAt: new Date().toISOString(),
        completedAt: new Date(Date.now() + 1000).toISOString(),
      })

      expect(() => validator.assertValidTiming(runId)).not.toThrow()
    })

    it('should throw when duration is zero', () => {
      addPhaseResult('intake', 0, { duration: 0 })

      expect(() => validator.assertValidTiming(runId)).toThrow(
        'positive duration',
      )
    })

    it('should throw when completedAt is before startedAt', () => {
      const now = Date.now()
      addPhaseResult('intake', 0, {
        startedAt: new Date(now + 1000).toISOString(),
        completedAt: new Date(now).toISOString(),
      })

      expect(() => validator.assertValidTiming(runId)).toThrow(
        'before startedAt',
      )
    })
  })

  describe('assertPhaseOutputShape', () => {
    it('should pass when output has all required keys', () => {
      addPhaseResult('intake', 0, {
        output: {
          featureName: 'test',
          designDoc: {},
          taskList: [],
        },
      })

      expect(() =>
        validator.assertPhaseOutputShape(runId, 'intake', [
          'featureName',
          'designDoc',
        ]),
      ).not.toThrow()
    })

    it('should throw when output is missing keys', () => {
      addPhaseResult('intake', 0, {
        output: { featureName: 'test' },
      })

      expect(() =>
        validator.assertPhaseOutputShape(runId, 'intake', [
          'featureName',
          'designDoc',
        ]),
      ).toThrow('missing required keys')
    })
  })

  describe('assertAllPhaseShapes', () => {
    it('should validate all 8 phase shapes', () => {
      addPhaseResult('intake', 0, {
        output: { featureName: 'test', designDoc: {}, taskList: [] },
      })
      addPhaseResult('validation', 1, {
        output: { approved: true, issues: [] },
      })
      addPhaseResult('architecture-analysis', 2, {
        output: { patterns: [], moduleBoundaries: [], adrsFound: 0 },
      })
      addPhaseResult('implementation', 3, {
        output: { modifiedFiles: [], addedTests: [], duration: 0, backend: '' },
      })
      addPhaseResult('architecture-review', 4, {
        output: { approved: true, violations: [] },
      })
      addPhaseResult('test-verification', 5, {
        output: { passed: true, testsRun: 0, coverage: 0, duration: 0 },
      })
      addPhaseResult('ui-validation', 6, {
        output: { approved: true, uiIssues: [] },
      })
      addPhaseResult('review-delivery', 7, {
        output: { consensus: 'passed', votes: [] },
      })

      expect(() => validator.assertAllPhaseShapes(runId)).not.toThrow()
    })
  })

  describe('assertRunStatus', () => {
    it('should pass when status matches', () => {
      expect(() => validator.assertRunStatus(runId, 'completed')).not.toThrow()
    })

    it('should throw when status does not match', () => {
      expect(() => validator.assertRunStatus(runId, 'running')).toThrow(
        "Expected run status 'running'",
      )
    })
  })

  describe('assertPhaseSuccess', () => {
    it('should pass when phase succeeded', () => {
      addPhaseResult('intake', 0, { status: 'success' })

      expect(() => validator.assertPhaseSuccess(runId, 'intake')).not.toThrow()
    })

    it('should throw when phase failed', () => {
      addPhaseResult('validation', 0, { status: 'failure' })

      expect(() => validator.assertPhaseSuccess(runId, 'validation')).toThrow(
        "status 'success'",
      )
    })
  })
})
