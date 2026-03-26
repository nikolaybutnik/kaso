/**
 * Phase Validator for E2E Testing
 *
 * Queries ExecutionStore to validate phase result records
 * for correct ordering, timing, status, and output shapes.
 *
 * Requirements: 3.3, 3.5, 3.6, 4.1–4.8
 */

import type { ExecutionStore } from '@/infrastructure/execution-store'
import type { PhaseName, PhaseResultRecord, RunStatus } from '@/core/types'

/** Expected output keys per phase for shape validation */
const PHASE_OUTPUT_SHAPES: Record<string, string[]> = {
  intake: ['featureName', 'designDoc', 'taskList'],
  validation: ['approved', 'issues'],
  'architecture-analysis': ['patterns', 'moduleBoundaries', 'adrsFound'],
  implementation: ['modifiedFiles', 'addedTests', 'duration', 'backend'],
  'architecture-review': ['approved', 'violations'],
  'test-verification': ['passed', 'testsRun', 'coverage', 'duration'],
  'ui-validation': ['approved', 'uiIssues'],
  'review-delivery': ['consensus', 'votes'],
}

const EXPECTED_PHASE_COUNT = 8

/**
 * Validates phase results stored in the ExecutionStore
 */
export class PhaseValidator {
  constructor(private executionStore: ExecutionStore) {}

  /** Get phase results for a run */
  getPhaseResults(runId: string): PhaseResultRecord[] {
    return this.executionStore.getPhaseResults(runId)
  }

  /**
   * Verify all 8 phases completed successfully
   * @throws Error if fewer than 8 results or any phase is not 'success'
   */
  assertAllPhasesCompleted(runId: string): void {
    const results = this.getPhaseResults(runId)

    if (results.length !== EXPECTED_PHASE_COUNT) {
      throw new Error(
        `Expected ${EXPECTED_PHASE_COUNT} phase results, got ${results.length}`,
      )
    }

    const incomplete = results.filter((r) => r.status !== 'success')
    if (incomplete.length > 0) {
      const names = incomplete.map((r) => `${r.phase}(${r.status})`).join(', ')
      throw new Error(`Phases incomplete: ${names}`)
    }
  }

  /**
   * Verify phase sequence numbers are monotonically increasing starting at 0
   * @throws Error if sequence is out of order or has gaps
   */
  assertSequenceOrder(runId: string): void {
    const results = this.getPhaseResults(runId)
    const sorted = [...results].sort((a, b) => a.sequence - b.sequence)

    for (let i = 0; i < sorted.length; i++) {
      const result = sorted[i]
      if (!result || result.sequence !== i) {
        throw new Error(
          `Expected sequence ${i}, got ${result?.sequence} for phase '${result?.phase}'`,
        )
      }
    }
  }

  /**
   * Verify each phase has valid timing: positive duration, valid timestamps,
   * completedAt not before startedAt
   * @throws Error on any timing violation
   */
  assertValidTiming(runId: string): void {
    const results = this.getPhaseResults(runId)

    for (const result of results) {
      if (!result.duration || result.duration <= 0) {
        throw new Error(
          `Phase '${result.phase}' must have positive duration, got ${result.duration}`,
        )
      }

      if (!result.startedAt || isNaN(Date.parse(result.startedAt))) {
        throw new Error(
          `Phase '${result.phase}' has invalid startedAt: ${result.startedAt}`,
        )
      }

      if (!result.completedAt || isNaN(Date.parse(result.completedAt))) {
        throw new Error(
          `Phase '${result.phase}' has invalid completedAt: ${result.completedAt}`,
        )
      }

      if (new Date(result.completedAt) < new Date(result.startedAt)) {
        throw new Error(
          `Phase '${result.phase}' completedAt is before startedAt`,
        )
      }
    }
  }

  /**
   * Verify a specific phase output contains all expected keys
   * @throws Error if phase not found or output is missing required keys
   */
  assertPhaseOutputShape(
    runId: string,
    phase: PhaseName,
    expectedKeys: string[],
  ): void {
    const results = this.getPhaseResults(runId)
    const phaseResult = results.find((r) => r.phase === phase)

    if (!phaseResult) {
      throw new Error(`Phase '${phase}' not found in results for run ${runId}`)
    }

    const output = phaseResult.output as Record<string, unknown> | undefined
    if (!output) {
      throw new Error(`Phase '${phase}' has no output`)
    }

    const outputKeys = Object.keys(output)
    const missingKeys = expectedKeys.filter((k) => !outputKeys.includes(k))

    if (missingKeys.length > 0) {
      throw new Error(
        `Phase '${phase}' output missing required keys: ${missingKeys.join(', ')}`,
      )
    }
  }

  /**
   * Validate all 8 phase output shapes against their expected interfaces
   * @throws Error if any phase output is missing required keys
   */
  assertAllPhaseShapes(runId: string): void {
    for (const [phase, keys] of Object.entries(PHASE_OUTPUT_SHAPES)) {
      this.assertPhaseOutputShape(runId, phase as PhaseName, keys)
    }
  }

  /**
   * Assert the run has a specific status
   * @throws Error if status doesn't match
   */
  assertRunStatus(runId: string, expectedStatus: RunStatus): void {
    const run = this.executionStore.getRun(runId)
    if (!run) {
      throw new Error(`Run '${runId}' not found`)
    }
    if (run.status !== expectedStatus) {
      throw new Error(
        `Expected run status '${expectedStatus}', got '${run.status}'`,
      )
    }
  }

  /**
   * Assert a specific phase completed with 'success' status
   * @throws Error if phase not found or status isn't 'success'
   */
  assertPhaseSuccess(runId: string, phase: PhaseName): void {
    const results = this.getPhaseResults(runId)
    const phaseResult = results.find((r) => r.phase === phase)

    if (!phaseResult) {
      throw new Error(`Phase '${phase}' not found for run '${runId}'`)
    }
    if (phaseResult.status !== 'success') {
      throw new Error(
        `Expected phase '${phase}' status 'success', got '${phaseResult.status}'`,
      )
    }
  }
}
