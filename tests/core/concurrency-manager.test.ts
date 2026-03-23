import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ConcurrencyManager } from '@/core/concurrency-manager'
import { EventBus } from '@/core/event-bus'

describe('ConcurrencyManager', () => {
  let manager: ConcurrencyManager
  let eventBus: EventBus

  beforeEach(() => {
    eventBus = new EventBus()
    manager = new ConcurrencyManager(3, eventBus)
  })

  describe('constructor', () => {
    it('should create manager with custom max slots', () => {
      const customManager = new ConcurrencyManager(5)
      expect(customManager.getMaxSlots()).toBe(5)
    })

    it('should default to CPU cores minus one', () => {
      const defaultManager = new ConcurrencyManager()
      const expectedSlots = Math.max(1, require('os').cpus().length - 1)
      expect(defaultManager.getMaxSlots()).toBe(expectedSlots)
    })

    it('should throw error for zero slots', () => {
      expect(() => new ConcurrencyManager(0)).toThrow(
        'maxSlots must be at least 1',
      )
    })

    it('should throw error for negative slots', () => {
      expect(() => new ConcurrencyManager(-1)).toThrow(
        'maxSlots must be at least 1',
      )
    })
  })

  describe('acquire and release', () => {
    it('should acquire slot when available', async () => {
      const slot = await manager.acquire('run-1', 'intake')

      expect(slot).toBeDefined()
      expect(slot.runId).toBe('run-1')
      expect(slot.phase).toBe('intake')
      expect(typeof slot.release).toBe('function')
      expect(manager.getActiveSlotCount()).toBe(1)
      expect(manager.hasActiveSlot('run-1', 'intake')).toBe(true)
    })

    it('should release slot', async () => {
      const slot = await manager.acquire('run-1', 'intake')
      expect(manager.getActiveSlotCount()).toBe(1)

      slot.release()

      expect(manager.getActiveSlotCount()).toBe(0)
      expect(manager.hasActiveSlot('run-1', 'intake')).toBe(false)
    })

    it('should support multiple concurrent slots', async () => {
      const slot1 = await manager.acquire('run-1', 'intake')
      const slot2 = await manager.acquire('run-2', 'validation')
      const slot3 = await manager.acquire('run-3', 'architecture-analysis')

      expect(manager.getActiveSlotCount()).toBe(3)
      expect(manager.hasActiveSlot('run-1', 'intake')).toBe(true)
      expect(manager.hasActiveSlot('run-2', 'validation')).toBe(true)
      expect(manager.hasActiveSlot('run-3', 'architecture-analysis')).toBe(true)

      slot1.release()
      expect(manager.getActiveSlotCount()).toBe(2)

      slot2.release()
      expect(manager.getActiveSlotCount()).toBe(1)

      slot3.release()
      expect(manager.getActiveSlotCount()).toBe(0)
    })

    it('should queue when all slots occupied', async () => {
      const slot1 = await manager.acquire('run-1', 'intake')
      const slot2 = await manager.acquire('run-2', 'validation')
      const slot3 = await manager.acquire('run-3', 'architecture-analysis')

      expect(manager.getActiveSlotCount()).toBe(3)
      expect(manager.getQueueLength()).toBe(0)

      const acquirePromise = manager.acquire('run-4', 'implementation')
      expect(manager.getQueueLength()).toBe(1)
      expect(manager.getActiveSlotCount()).toBe(3)

      slot1.release()
      const slot4 = await acquirePromise
      expect(slot4.runId).toBe('run-4')
      expect(manager.getActiveSlotCount()).toBe(3)
      expect(manager.getQueueLength()).toBe(0)

      slot2.release()
      slot3.release()
      slot4.release()
    })
  })

  describe('queue behavior', () => {
    it('should clear queue', async () => {
      await manager.acquire('run-1', 'intake')
      await manager.acquire('run-2', 'validation')
      await manager.acquire('run-3', 'architecture-analysis')

      const queuedPromises = [
        manager.acquire('run-4', 'implementation'),
        manager.acquire('run-5', 'test-verification'),
      ]

      expect(manager.getQueueLength()).toBe(2)
      manager.clearQueue()
      expect(manager.getQueueLength()).toBe(0)

      await expect(queuedPromises[0]).rejects.toThrow('Queue cleared')
      await expect(queuedPromises[1]).rejects.toThrow('Queue cleared')
    })
  })

  describe('metrics', () => {
    it('should return queue metrics', async () => {
      await manager.acquire('run-1', 'intake')
      await manager.acquire('run-2', 'validation')
      await manager.acquire('run-3', 'architecture-analysis')

      manager.acquire('run-4', 'implementation')
      manager.acquire('run-5', 'test-verification')

      await new Promise((resolve) => setTimeout(resolve, 10))

      const metrics = manager.getQueueMetrics()
      expect(metrics.length).toBe(2)
      expect(metrics.oldestWaitTime).toBeGreaterThanOrEqual(0)
      expect(metrics.averageWaitTime).toBeGreaterThanOrEqual(0)
    })
  })

  describe('events', () => {
    it('should emit events with event bus', async () => {
      const eventListener = vi.fn()
      eventBus.onAny(eventListener)

      const slot = await manager.acquire('run-1', 'intake')

      expect(eventListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'concurrency:acquired',
          runId: 'run-1',
        }),
      )

      slot.release()

      expect(eventListener).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'concurrency:released',
          runId: 'run-1',
        }),
      )
    })
  })
})
