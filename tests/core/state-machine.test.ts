import { describe, it, expect, beforeEach } from 'vitest'
import { StateMachine } from '@/core/state-machine'
import { PhaseResult, PhaseName } from '@/core/types'
import { EventBus } from '@/core/event-bus'

/** Helper to create a successful PhaseResult */
function successResult(phase: PhaseName): PhaseResult {
  return {
    phase,
    status: 'success',
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    duration: 1000,
  }
}

/** Helper to create a failed PhaseResult */
function failureResult(phase: PhaseName, retryable: boolean): PhaseResult {
  return {
    phase,
    status: 'failure',
    startedAt: new Date().toISOString(),
    error: {
      message: `${phase} failed`,
      code: 'PHASE_FAILURE',
      retryable,
    },
  }
}

describe('StateMachine', () => {
  let machine: StateMachine
  let eventBus: EventBus

  beforeEach(() => {
    eventBus = new EventBus()
    machine = new StateMachine(100, eventBus)
  })

  describe('initialization', () => {
    it('should initialize with pending status', () => {
      expect(machine.getStatus()).toBe('pending')
      expect(machine.getCurrentPhase()).toBeUndefined()
    })

    it('should configure default 8-phase pipeline', () => {
      expect(machine.getPhaseCount()).toBe(8)
    })
  })

  describe('pipeline execution', () => {
    it('should start pipeline and move to first phase', () => {
      const transition = machine.start()

      expect(transition.from).toBeUndefined()
      expect(transition.to).toBe('intake')
      expect(transition.trigger).toBe('resume')
      expect(machine.getStatus()).toBe('running')
      expect(machine.getCurrentPhase()).toBe('intake')
    })

    it('should not start pipeline if already started', () => {
      machine.start()
      expect(() => machine.start()).toThrow(
        'Cannot start pipeline from status: running',
      )
    })
  })

  describe('failure handling', () => {
    it('should halt pipeline on non-retryable failure', () => {
      machine.start()

      const transition = machine.transition(failureResult('intake', false))

      expect(transition.trigger).toBe('failure')
      expect(machine.getStatus()).toBe('failed')
    })

    it('should retry failed phase up to maxRetries', () => {
      machine.start()
      machine.transition(successResult('intake'))

      // Validation has maxRetries=1 by default
      const t1 = machine.transition(failureResult('validation', true))
      expect(t1.trigger).toBe('retry')
      expect(machine.getCurrentPhase()).toBe('validation')

      const t2 = machine.transition(failureResult('validation', true))
      expect(t2.trigger).toBe('failure')
      expect(machine.getStatus()).toBe('failed')
    })

    it('should loop back to implementation when allowed', () => {
      machine.start()
      const phasesToComplete: PhaseName[] = [
        'intake',
        'validation',
        'architecture-analysis',
        'implementation',
        'architecture-review',
      ]
      for (const phase of phasesToComplete) {
        machine.transition(successResult(phase))
      }
      expect(machine.getCurrentPhase()).toBe('test-verification')

      machine.setPhaseConfig('test-verification' as PhaseName, {
        maxRetries: 0,
      })
      const transition = machine.transition(
        failureResult('test-verification', false),
      )

      expect(transition.trigger).toBe('loopback')
      expect(transition.to).toBe('implementation')
    })

    it('should skip phase when skipOnFailure is set', () => {
      machine.start()
      machine.transition(successResult('intake'))

      machine.setPhaseConfig('validation' as PhaseName, {
        maxRetries: 0,
        skipOnFailure: true,
      })

      const transition = machine.transition(failureResult('validation', false))
      expect(transition.trigger).toBe('skip')
      expect(machine.getCurrentPhase()).toBe('architecture-analysis')
    })
  })

  describe('pause and resume', () => {
    it('should pause pipeline during execution', () => {
      machine.start()
      const t = machine.pause()
      expect(t.trigger).toBe('pause')
      expect(machine.isPaused()).toBe(true)
      expect(machine.getStatus()).toBe('paused')
    })

    it('should resume paused pipeline', () => {
      machine.start()
      machine.pause()
      const t = machine.resume()
      expect(t.trigger).toBe('resume')
      expect(machine.isPaused()).toBe(false)
      expect(machine.getStatus()).toBe('running')
    })

    it('should not pause non-running pipeline', () => {
      expect(() => machine.pause()).toThrow(
        'Cannot pause pipeline from status: pending',
      )
    })

    it('should not resume non-paused pipeline', () => {
      machine.start()
      expect(() => machine.resume()).toThrow('Pipeline is not paused')
    })
  })

  describe('cancel', () => {
    it('should cancel running pipeline', () => {
      machine.start()
      const t = machine.cancel()
      expect(t.trigger).toBe('cancel')
      expect(machine.isCancelled()).toBe(true)
      expect(machine.getStatus()).toBe('cancelled')
    })

    it('should preserve current phase info after cancel', () => {
      machine.start()
      machine.transition(successResult('intake'))
      expect(machine.getCurrentPhase()).toBe('validation')
      machine.cancel()
      expect(machine.getCurrentPhase()).toBe('validation')
    })
  })

  describe('phase configuration', () => {
    it('should allow custom phase configuration', () => {
      machine.setPhaseConfig('validation' as PhaseName, {
        maxRetries: 5,
        loopBackAllowed: true,
        skipOnFailure: true,
        required: true,
      })

      const config = machine.getPhaseConfig('validation' as PhaseName)
      expect(config.maxRetries).toBe(5)
      expect(config.loopBackAllowed).toBe(true)
      expect(config.skipOnFailure).toBe(true)
      expect(config.required).toBe(true)
    })

    it('should reject unknown phases', () => {
      expect(() => {
        machine.getPhaseConfig('unknown-phase' as PhaseName)
      }).toThrow('No configuration found for phase: unknown-phase')
    })

    it('should apply custom config to built-in phases', () => {
      machine.setPhaseConfig('implementation' as PhaseName, { maxRetries: 0 })
      const config = machine.getPhaseConfig('implementation' as PhaseName)
      expect(config.maxRetries).toBe(0)
      expect(config.loopBackAllowed).toBe(false)
    })
  })

  describe('history and progress', () => {
    it('should track transition history', () => {
      machine.start()
      machine.transition(successResult('intake'))
      const history = machine.getHistory()
      expect(history.length).toBe(2)
      expect(history[0]?.trigger).toBe('resume')
      expect(history[1]?.trigger).toBe('success')
    })

    it('should report progress correctly', () => {
      machine.start()
      expect(machine.getProgress()).toBe(0)
      machine.transition(successResult('intake'))
      expect(machine.getProgress()).toBe(1 / 8)
    })
  })

  describe('event emission', () => {
    it('should emit run:started when pipeline starts', () => {
      const events: string[] = []
      eventBus.on('run:started', () => {
        events.push('run:started')
      })
      machine.start()
      expect(events).toContain('run:started')
    })

    it('should emit phase:started when entering a new phase', () => {
      const events: string[] = []
      eventBus.on('phase:started', () => {
        events.push('phase:started')
      })
      machine.start()
      expect(events).toContain('phase:started')
    })

    it('should emit phase:completed on success transition', () => {
      const events: string[] = []
      eventBus.on('phase:completed', () => {
        events.push('phase:completed')
      })
      machine.start()
      machine.transition(successResult('intake'))
      expect(events).toContain('phase:completed')
    })

    it('should emit run:completed when pipeline finishes', () => {
      const events: string[] = []
      eventBus.on('run:completed', () => {
        events.push('run:completed')
      })
      machine.start()
      const allPhases: PhaseName[] = [
        'intake',
        'validation',
        'architecture-analysis',
        'implementation',
        'architecture-review',
        'test-verification',
        'ui-validation',
        'review-delivery',
      ]
      for (const phase of allPhases) {
        machine.transition(successResult(phase))
      }
      expect(events).toContain('run:completed')
    })

    it('should emit run:failed when pipeline halts', () => {
      const events: string[] = []
      eventBus.on('run:failed', () => {
        events.push('run:failed')
      })
      machine.start()
      machine.setPhaseConfig('intake' as PhaseName, { maxRetries: 0 })
      machine.transition(failureResult('intake', false))
      expect(events).toContain('run:failed')
    })

    it('should emit run:cancelled on cancel', () => {
      const events: string[] = []
      eventBus.on('run:cancelled', () => {
        events.push('run:cancelled')
      })
      machine.start()
      machine.cancel()
      expect(events).toContain('run:cancelled')
    })

    it('should emit phase:timeout for timeout results', () => {
      const events: string[] = []
      eventBus.on('phase:timeout', () => {
        events.push('phase:timeout')
      })
      machine.start()
      const timeoutResult: PhaseResult = {
        phase: 'intake',
        status: 'timeout',
        startedAt: new Date().toISOString(),
      }
      machine.transition(timeoutResult)
      expect(events).toContain('phase:timeout')
    })

    it('should use provided runId in emitted events', () => {
      const customBus = new EventBus()
      const customMachine = new StateMachine(
        100,
        customBus,
        undefined,
        'run-123',
      )
      let capturedRunId = ''
      customBus.onAny((event) => {
        capturedRunId = event.runId
      })
      customMachine.start()
      expect(capturedRunId).toBe('run-123')
    })
  })
})
