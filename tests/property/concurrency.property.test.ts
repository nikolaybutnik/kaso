import { test, fc } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { ConcurrencyManager, ConcurrencySlot } from '@/core/concurrency-manager'

describe('Property 38: Concurrency limit enforced', () => {
  /**
   * Property 38: Concurrency limit enforced
   * For any state where the number of concurrently executing agents equals
   * the configured maximum, additional agent execution requests SHALL be queued
   * until a slot is released.
   *
   * Validates: Requirements 21.1, 21.3
   */
  test.prop([
    fc.integer({ min: 1, max: 5 }), // maxSlots
  ])('should queue requests when all slots are occupied', async (maxSlots) => {
    const manager = new ConcurrencyManager(maxSlots)

    // Fill all slots
    const slots: ConcurrencySlot[] = []
    for (let i = 0; i < maxSlots; i++) {
      slots.push(await manager.acquire(`run-${i}`, 'intake'))
    }

    expect(manager.getActiveSlotCount()).toBe(maxSlots)
    expect(manager.getQueueLength()).toBe(0)

    // Queue one more request
    const queuedPromise = manager.acquire('queued-run', 'intake')
    expect(manager.getQueueLength()).toBe(1)

    // Release a slot to let queued request through
    const firstSlot = slots[0]
    if (!firstSlot) throw new Error('Expected slot at index 0')
    firstSlot.release()

    // Queued request should get processed
    const queuedSlot = await queuedPromise
    expect(queuedSlot.runId).toBe('queued-run')
    expect(manager.getQueueLength()).toBe(0)
    expect(manager.getActiveSlotCount()).toBe(maxSlots)

    // Cleanup
    queuedSlot.release()
    for (let i = 1; i < slots.length; i++) {
      slots[i]?.release()
    }
  })

  /**
   * Additional property: Queue ordering
   * Queued requests SHALL be processed in order of arrival
   */
  test.prop([
    fc.integer({ min: 2, max: 4 }), // maxSlots
  ])('should process queued requests in arrival order', async (maxSlots) => {
    const manager = new ConcurrencyManager(maxSlots)

    // Fill all slots
    const slots = await Promise.all(
      Array.from({ length: maxSlots }, (_, i) =>
        manager.acquire(`run-${i}`, 'intake'),
      ),
    )

    // Queue two requests
    const firstPromise = manager.acquire('queued-1', 'intake')
    const secondPromise = manager.acquire('queued-2', 'intake')

    // Verify queue state
    expect(manager.getQueueLength()).toBe(2)

    // Release first slot - should process first queued request
    const slot0 = slots[0]
    if (!slot0) throw new Error('Expected slot at index 0')
    slot0.release()
    const firstResult = await firstPromise
    expect(firstResult.runId).toBe('queued-1')
    expect(manager.getQueueLength()).toBe(1)

    // Release second slot - should process second queued request
    const slot1 = slots[1]
    if (!slot1) throw new Error('Expected slot at index 1')
    slot1.release()
    const secondResult = await secondPromise
    expect(secondResult.runId).toBe('queued-2')
    expect(manager.getQueueLength()).toBe(0)

    // Cleanup
    firstResult.release()
    secondResult.release()
    for (let i = 2; i < slots.length; i++) {
      slots[i]?.release()
    }
  })
})
