/**
 * Unit Tests for EventCollector Helper
 *
 * Requirements: 3.4, 9.1, 9.4
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { EventBus } from '@/core/event-bus'
import { EventCollector } from './event-collector'
// No additional imports needed

describe('EventCollector', () => {
  let eventBus: EventBus
  let collector: EventCollector

  beforeEach(() => {
    eventBus = new EventBus()
    collector = new EventCollector(eventBus)
  })

  describe('event collection', () => {
    it('should collect events from EventBus', () => {
      eventBus.emit({
        type: 'run:started',
        runId: 'test-1',
        timestamp: new Date().toISOString(),
      })

      expect(collector.getEvents()).toHaveLength(1)
    })

    it('should get events by type', () => {
      eventBus.emit({
        type: 'run:started',
        runId: 'test-1',
        timestamp: new Date().toISOString(),
      })
      eventBus.emit({
        type: 'phase:started',
        runId: 'test-1',
        timestamp: new Date().toISOString(),
        phase: 'intake',
      })
      eventBus.emit({
        type: 'run:started',
        runId: 'test-2',
        timestamp: new Date().toISOString(),
      })

      const runEvents = collector.getByType('run:started')
      expect(runEvents).toHaveLength(2)
    })

    it('should get events by runId', () => {
      eventBus.emit({
        type: 'run:started',
        runId: 'run-a',
        timestamp: new Date().toISOString(),
      })
      eventBus.emit({
        type: 'run:started',
        runId: 'run-b',
        timestamp: new Date().toISOString(),
      })

      const runAEvents = collector.getByRunId('run-a')
      expect(runAEvents).toHaveLength(1)
      expect(runAEvents[0]?.runId).toBe('run-a')
    })

    it('should get events by phase', () => {
      eventBus.emit({
        type: 'phase:started',
        runId: 'test-1',
        timestamp: new Date().toISOString(),
        phase: 'intake',
      })
      eventBus.emit({
        type: 'phase:started',
        runId: 'test-1',
        timestamp: new Date().toISOString(),
        phase: 'validation',
      })

      const intakeEvents = collector.getByPhase('intake')
      expect(intakeEvents).toHaveLength(1)
    })
  })

  describe('assertions', () => {
    it('should assert minimum count', () => {
      eventBus.emit({
        type: 'phase:started',
        runId: 'test-1',
        timestamp: new Date().toISOString(),
        phase: 'intake',
      })
      eventBus.emit({
        type: 'phase:started',
        runId: 'test-1',
        timestamp: new Date().toISOString(),
        phase: 'validation',
      })

      expect(() => collector.assertMinCount('phase:started', 1)).not.toThrow()
      expect(() => collector.assertMinCount('phase:started', 3)).toThrow()
    })

    it('should assert event ordering', () => {
      const now = Date.now()

      eventBus.emit({
        type: 'run:started',
        runId: 'test-1',
        timestamp: new Date(now).toISOString(),
      })
      eventBus.emit({
        type: 'run:completed',
        runId: 'test-1',
        timestamp: new Date(now + 100).toISOString(),
      })

      expect(() =>
        collector.assertOrdering('run:started', 'run:completed'),
      ).not.toThrow()
    })
  })

  describe('cleanup', () => {
    it('should clear events', () => {
      eventBus.emit({
        type: 'run:started',
        runId: 'test-1',
        timestamp: new Date().toISOString(),
      })

      expect(collector.getEvents()).toHaveLength(1)
      collector.clear()
      expect(collector.getEvents()).toHaveLength(0)
    })

    it('should dispose and unsubscribe', () => {
      collector.dispose()

      eventBus.emit({
        type: 'run:started',
        runId: 'test-1',
        timestamp: new Date().toISOString(),
      })

      expect(collector.getEvents()).toHaveLength(0)
    })
  })

  describe('waitForEvent', () => {
    it('should wait for event', async () => {
      const waitPromise = collector.waitForEvent('phase:completed', 1000)

      // Emit after short delay
      setTimeout(() => {
        eventBus.emit({
          type: 'phase:completed',
          runId: 'test-1',
          timestamp: new Date().toISOString(),
          phase: 'intake',
        })
      }, 50)

      const event = await waitPromise
      expect(event.type).toBe('phase:completed')
    })

    it('should timeout if event not received', async () => {
      await expect(
        collector.waitForEvent('phase:completed', 100),
      ).rejects.toThrow('Timeout')
    })

    it('should return immediately if event already exists', async () => {
      eventBus.emit({
        type: 'phase:completed',
        runId: 'test-1',
        timestamp: new Date().toISOString(),
        phase: 'intake',
      })

      const event = await collector.waitForEvent('phase:completed', 1000)
      expect(event.type).toBe('phase:completed')
    })
  })
})
