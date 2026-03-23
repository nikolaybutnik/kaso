import { test, fc } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { StateMachine } from '@/core/state-machine'
import { PhaseName, PhaseResult } from '@/core/types'

const PIPELINE_PHASES: PhaseName[] = [
  'intake',
  'validation',
  'architecture-analysis',
  'implementation',
  'architecture-review',
  'test-verification',
  'ui-validation',
  'review-delivery',
]

function successResult(phase: PhaseName): PhaseResult {
  return {
    phase,
    status: 'success',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    duration: 1000,
  }
}

function failureResult(phase: PhaseName, retryable: boolean): PhaseResult {
  return {
    phase,
    status: 'failure',
    startedAt: new Date().toISOString(),
    error: {
      message: `${phase} failed`,
      code: 'TEST_FAILURE',
      retryable,
    },
  }
}

describe('State Machine Properties', () => {
  /**
   * Property 9: Pipeline executes phases in sequential order
   * Validates: Requirement 6.1
   */
  test.prop([fc.integer({ min: 1, max: 7 })])(
    'Property 9: Pipeline phases execute in sequential order',
    (phasesToComplete) => {
      const machine = new StateMachine(100)
      machine.start()
      expect(machine.getCurrentPhase()).toBe('intake')

      for (let i = 0; i < phasesToComplete; i++) {
        expect(machine.getCurrentPhase()).toBe(PIPELINE_PHASES[i])

        const transition = machine.transition(
          successResult(PIPELINE_PHASES[i]!),
        )

        expect(transition.from).toBe(PIPELINE_PHASES[i])
        if (i < PIPELINE_PHASES.length - 1) {
          expect(transition.to).toBe(PIPELINE_PHASES[i + 1])
          expect(transition.trigger).toBe('success')
        }
      }

      expect(machine.getCurrentPhase()).toBe(PIPELINE_PHASES[phasesToComplete])
    },
  )

  /**
   * Property 11: Failing phase results trigger appropriate pipeline response
   * Validates: Requirements 6.3, 12.4, 13.5
   */
  test.prop([
    fc.constantFrom(
      'validation' as PhaseName,
      'architecture-review' as PhaseName,
      'test-verification' as PhaseName,
    ),
    fc.record({
      maxRetries: fc.integer({ min: 0, max: 3 }),
      loopBackAllowed: fc.boolean(),
      skipOnFailure: fc.boolean(),
      allowRetry: fc.boolean(),
    }),
  ])('Property 11: Phase failures handled per policy', (phase, config) => {
    fc.pre(
      phase === 'test-verification' ||
        phase === 'architecture-review' ||
        !config.loopBackAllowed,
    )

    const machine = new StateMachine(100)
    machine.start()

    const targetIndex = PIPELINE_PHASES.indexOf(phase)
    for (let i = 0; i < targetIndex; i++) {
      machine.transition(successResult(PIPELINE_PHASES[i]!))
    }

    machine.setPhaseConfig(phase, {
      maxRetries: config.maxRetries,
      loopBackAllowed: config.loopBackAllowed,
      skipOnFailure: config.skipOnFailure,
      required: true,
    })

    const fail = failureResult(phase, config.allowRetry)

    if (config.allowRetry && config.maxRetries > 0) {
      for (let i = 0; i < config.maxRetries; i++) {
        const t = machine.transition(fail)
        expect(t.trigger).toBe('retry')
      }
    }

    const t = machine.transition(fail)
    if (config.loopBackAllowed) {
      expect(t.trigger).toBe('loopback')
      expect(t.to).toBe('implementation')
    } else if (config.skipOnFailure) {
      expect(t.trigger).toBe('skip')
    } else {
      expect(t.trigger).toBe('failure')
      expect(machine.getStatus()).toBe('failed')
    }
  })

  /**
   * Pause/resume preserves state
   */
  test.prop([fc.integer({ min: 1, max: 3 })])(
    'should preserve state through pause/resume cycles',
    (phasesBeforePause) => {
      const machine = new StateMachine(100)
      machine.start()

      for (let i = 0; i < phasesBeforePause; i++) {
        machine.transition(successResult(PIPELINE_PHASES[i]!))
      }

      const phaseBeforePause = machine.getCurrentPhase()
      expect(phaseBeforePause).toBe(PIPELINE_PHASES[phasesBeforePause])

      machine.pause()
      expect(machine.isPaused()).toBe(true)
      expect(machine.getCurrentPhase()).toBe(phaseBeforePause)

      machine.resume()
      expect(machine.isPaused()).toBe(false)
      expect(machine.getCurrentPhase()).toBe(phaseBeforePause)
      expect(machine.getStatus()).toBe('running')
    },
  )

  /**
   * Cancel terminates pipeline cleanly
   */
  test.prop([fc.integer({ min: 0, max: 7 })])(
    'should cancel pipeline and preserve state',
    (phaseIndex) => {
      const machine = new StateMachine(100)
      machine.start()

      for (let i = 0; i < phaseIndex && i < PIPELINE_PHASES.length - 1; i++) {
        machine.transition(successResult(PIPELINE_PHASES[i]!))
      }

      const phaseAtCancel = machine.getCurrentPhase()
      expect(phaseAtCancel).toBe(
        PIPELINE_PHASES[Math.min(phaseIndex, PIPELINE_PHASES.length - 1)],
      )

      machine.cancel()

      expect(machine.isCancelled()).toBe(true)
      expect(machine.getStatus()).toBe('cancelled')
      expect(machine.getCurrentPhase()).toBe(phaseAtCancel)
    },
  )
})
