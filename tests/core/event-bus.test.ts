import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventBus } from '@/core/event-bus'
import { ExecutionEvent } from '@/core/types'

describe('EventBus', () => {
  let eventBus: EventBus

  beforeEach(() => {
    eventBus = new EventBus()
  })

  describe('subscribe and emit', () => {
    it('should call listener when event is emitted', () => {
      const listener = vi.fn()
      eventBus.on('phase:started', listener)

      const event: ExecutionEvent = {
        type: 'phase:started',
        runId: 'test-run',
        timestamp: new Date().toISOString(),
      }

      eventBus.emit(event)
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(event)
    })

    it('should support multiple listeners', () => {
      const listener1 = vi.fn()
      const listener2 = vi.fn()

      eventBus.on('phase:started', listener1)
      eventBus.on('phase:started', listener2)

      const event: ExecutionEvent = {
        type: 'phase:started',
        runId: 'test-run',
        timestamp: new Date().toISOString(),
      }

      eventBus.emit(event)
      expect(listener1).toHaveBeenCalledTimes(1)
      expect(listener2).toHaveBeenCalledTimes(1)
    })

    it('should unsubscribe listeners', () => {
      const listener = vi.fn()
      const unsubscribe = eventBus.on('phase:started', listener)

      const event: ExecutionEvent = {
        type: 'phase:started',
        runId: 'test-run',
        timestamp: new Date().toISOString(),
      }

      eventBus.emit(event)
      expect(listener).toHaveBeenCalledTimes(1)

      unsubscribe()
      eventBus.emit(event)
      expect(listener).toHaveBeenCalledTimes(1)
    })
  })

  describe('onAny', () => {
    it('should receive all events', () => {
      const listener = vi.fn()
      eventBus.onAny(listener)

      const event1: ExecutionEvent = {
        type: 'phase:started',
        runId: 'test-run',
        timestamp: new Date().toISOString(),
      }

      const event2: ExecutionEvent = {
        type: 'run:completed',
        runId: 'test-run',
        timestamp: new Date().toISOString(),
      }

      eventBus.emit(event1)
      eventBus.emit(event2)

      expect(listener).toHaveBeenCalledTimes(2)
    })

    it('should unsubscribe from all events', () => {
      const listener = vi.fn()
      const unsubscribe = eventBus.onAny(listener)

      const event: ExecutionEvent = {
        type: 'phase:started',
        runId: 'test-run',
        timestamp: new Date().toISOString(),
      }

      eventBus.emit(event)
      expect(listener).toHaveBeenCalledTimes(1)

      unsubscribe()
      eventBus.emit(event)
      expect(listener).toHaveBeenCalledTimes(1)
    })
  })

  describe('event history', () => {
    it('should store events in history', () => {
      const event1: ExecutionEvent = {
        type: 'phase:started',
        runId: 'test-run-1',
        timestamp: new Date().toISOString(),
      }

      const event2: ExecutionEvent = {
        type: 'phase:completed',
        runId: 'test-run-1',
        timestamp: new Date().toISOString(),
      }

      eventBus.emit(event1)
      eventBus.emit(event2)

      const recentEvents = eventBus.getRecentEvents()
      expect(recentEvents).toHaveLength(2)
    })

    it('should limit history size', () => {
      const smallBus = new EventBus(3)

      for (let i = 0; i < 5; i++) {
        smallBus.emit({
          type: 'phase:started',
          runId: `test-run-${i}`,
          timestamp: new Date().toISOString(),
        })
      }

      const recentEvents = smallBus.getRecentEvents()
      expect(recentEvents).toHaveLength(3)
    })
  })

  describe('error handling', () => {
    it('should handle listener errors gracefully', () => {
      const errorListener = vi.fn(() => {
        throw new Error('Listener error')
      })
      const goodListener = vi.fn()

      eventBus.on('phase:started', errorListener)
      eventBus.on('phase:started', goodListener)

      const event: ExecutionEvent = {
        type: 'phase:started',
        runId: 'test-run',
        timestamp: new Date().toISOString(),
      }

      expect(() => eventBus.emit(event)).not.toThrow()
      expect(errorListener).toHaveBeenCalledTimes(1)
      expect(goodListener).toHaveBeenCalledTimes(1)
    })

    it('should handle async listener errors', async () => {
      const consoleErrorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {})

      const errorAsyncListener = vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        throw new Error('Async listener error')
      })

      eventBus.on('phase:started', errorAsyncListener)

      const event: ExecutionEvent = {
        type: 'phase:started',
        runId: 'test-run',
        timestamp: new Date().toISOString(),
      }

      eventBus.emit(event)
      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(errorAsyncListener).toHaveBeenCalledTimes(1)
      expect(consoleErrorSpy).toHaveBeenCalled()
      consoleErrorSpy.mockRestore()
    })
  })

  describe('listener count', () => {
    it('should count listeners correctly', () => {
      eventBus.on('phase:started', vi.fn())
      eventBus.on('phase:started', vi.fn())
      eventBus.on('phase:completed', vi.fn())

      expect(eventBus.getListenerCount('phase:started')).toBe(2)
      expect(eventBus.getListenerCount('phase:completed')).toBe(1)
      expect(eventBus.getListenerCount('run:started')).toBe(0)
    })

    it('should count all listeners', () => {
      eventBus.on('phase:started', vi.fn())
      eventBus.on('phase:completed', vi.fn())
      eventBus.onAny(vi.fn())

      expect(eventBus.getListenerCount()).toBe(3)
    })
  })

  describe('cleanup', () => {
    it('should remove all listeners', () => {
      eventBus.on('phase:started', vi.fn())
      eventBus.onAny(vi.fn())

      expect(eventBus.getListenerCount()).toBe(2)

      eventBus.removeAllListeners()
      expect(eventBus.getListenerCount()).toBe(0)
    })

    it('should clear history', () => {
      eventBus.emit({
        type: 'phase:started',
        runId: 'test-run',
        timestamp: new Date().toISOString(),
      })

      expect(eventBus.getRecentEvents()).toHaveLength(1)

      eventBus.clearHistory()
      expect(eventBus.getRecentEvents()).toHaveLength(0)
    })
  })

  // ============================================================================
  // Feature: configurable-backends-review
  // ============================================================================

  describe('agent:backend-selected event type', () => {
    it('should accept and emit agent:backend-selected event', () => {
      const listener = vi.fn()
      eventBus.on('agent:backend-selected', listener)

      const event: ExecutionEvent = {
        type: 'agent:backend-selected',
        runId: 'test-run',
        timestamp: new Date().toISOString(),
        phase: 'implementation',
        data: {
          backend: 'claude-code',
          reason: 'phase-override',
        },
      }

      eventBus.emit(event)
      expect(listener).toHaveBeenCalledTimes(1)
      expect(listener).toHaveBeenCalledWith(event)
    })

    it('should include reviewerRole in agent:backend-selected for reviewer-override', () => {
      const listener = vi.fn()
      eventBus.on('agent:backend-selected', listener)

      const event: ExecutionEvent = {
        type: 'agent:backend-selected',
        runId: 'test-run',
        timestamp: new Date().toISOString(),
        phase: 'review-delivery',
        data: {
          backend: 'claude-code',
          reason: 'reviewer-override',
          reviewerRole: 'security',
        },
      }

      eventBus.emit(event)
      expect(listener).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          backend: 'claude-code',
          reason: 'reviewer-override',
          reviewerRole: 'security',
        }),
      }))
    })

    it('should handle all selection reasons in agent:backend-selected', () => {
      const reasons = ['phase-override', 'context-aware', 'default', 'retry-override', 'reviewer-override']
      const listener = vi.fn()
      eventBus.on('agent:backend-selected', listener)

      for (const reason of reasons) {
        eventBus.emit({
          type: 'agent:backend-selected',
          runId: 'test-run',
          timestamp: new Date().toISOString(),
          data: { backend: 'test-backend', reason },
        })
      }

      expect(listener).toHaveBeenCalledTimes(reasons.length)
    })

    it('should store agent:backend-selected in event history', () => {
      const event: ExecutionEvent = {
        type: 'agent:backend-selected',
        runId: 'test-run',
        timestamp: new Date().toISOString(),
        phase: 'implementation',
        data: {
          backend: 'claude-code',
          reason: 'phase-override',
        },
      }

      eventBus.emit(event)
      const recentEvents = eventBus.getRecentEvents()

      expect(recentEvents).toHaveLength(1)
      expect(recentEvents[0]?.type).toBe('agent:backend-selected')
    })
  })
})
