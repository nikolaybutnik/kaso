import { EventBus } from './event-bus'
import { ExecutionEvent, PhaseName } from './types'
import { cpus } from 'os'

/**
 * Concurrency slot representing an acquired execution slot
 */
export interface ConcurrencySlot {
  runId: string
  phase: PhaseName
  release: () => void
}

/**
 * Queued request waiting for a concurrency slot
 */
interface QueuedRequest {
  runId: string
  phase: PhaseName
  resolve: (slot: ConcurrencySlot) => void
  reject: (error: Error) => void
  timestamp: number
}

/**
 * Concurrency manager with slot-based limiting and queuing
 * Default max slots to CPU cores minus one
 */
export class ConcurrencyManager {
  private maxSlots: number
  private activeSlots = new Set<string>()
  private queue: QueuedRequest[] = []
  private eventBus?: EventBus

  constructor(maxSlots?: number, eventBus?: EventBus) {
    this.maxSlots = maxSlots ?? Math.max(1, cpus().length - 1)
    this.eventBus = eventBus

    if (this.maxSlots < 1) {
      throw new Error('maxSlots must be at least 1')
    }
  }

  /**
   * Acquire a concurrency slot for a run/phase
   * Returns a slot object with release function
   * Queues if all slots are occupied
   */
  async acquire(runId: string, phase: PhaseName): Promise<ConcurrencySlot> {
    if (this.activeSlots.size < this.maxSlots) {
      return this.acquireSlot(runId, phase)
    }

    return new Promise<ConcurrencySlot>((resolve, reject) => {
      const queuedRequest: QueuedRequest = {
        runId,
        phase,
        resolve,
        reject,
        timestamp: Date.now(),
      }
      this.queue.push(queuedRequest)

      this.emitQueueEvent('concurrency:queued', runId, phase, this.queue.length)

      if (this.queue.length > this.maxSlots * 2) {
        console.warn(
          `Concurrency queue growing: ${this.queue.length} requests waiting for ${this.maxSlots} slots`,
        )
      }
    })
  }

  /**
   * Acquire a slot immediately (internal method)
   */
  private acquireSlot(runId: string, phase: PhaseName): ConcurrencySlot {
    const slotId = `${runId}:${phase}`
    this.activeSlots.add(slotId)

    this.emitSlotEvent(
      'concurrency:acquired',
      runId,
      phase,
      this.activeSlots.size,
    )

    const slot: ConcurrencySlot = {
      runId,
      phase,
      release: () => {
        this.releaseSlot(slotId, runId, phase)
      },
    }

    return slot
  }

  /**
   * Release a concurrency slot and process queue
   */
  private releaseSlot(slotId: string, runId: string, phase: PhaseName): void {
    if (!this.activeSlots.has(slotId)) {
      console.warn(`Attempted to release inactive slot: ${slotId}`)
      return
    }

    this.activeSlots.delete(slotId)
    this.emitSlotEvent(
      'concurrency:released',
      runId,
      phase,
      this.activeSlots.size,
    )
    this.processQueue()
  }

  /**
   * Process next request from queue
   */
  private processQueue(): void {
    if (this.queue.length === 0 || this.activeSlots.size >= this.maxSlots) {
      return
    }

    const nextRequest = this.queue.shift()
    if (!nextRequest) {
      return
    }

    try {
      this.emitQueueEvent(
        'concurrency:dequeued',
        nextRequest.runId,
        nextRequest.phase,
        this.queue.length,
      )
      const slot = this.acquireSlot(nextRequest.runId, nextRequest.phase)
      nextRequest.resolve(slot)
    } catch (error) {
      nextRequest.reject(
        error instanceof Error ? error : new Error(String(error)),
      )
    }
  }

  /**
   * Get current active slot count
   */
  getActiveSlotCount(): number {
    return this.activeSlots.size
  }

  /**
   * Get queue length
   */
  getQueueLength(): number {
    return this.queue.length
  }

  /**
   * Get max slots
   */
  getMaxSlots(): number {
    return this.maxSlots
  }

  /**
   * Check if a run/phase has an active slot
   */
  hasActiveSlot(runId: string, phase: PhaseName): boolean {
    const slotId = `${runId}:${phase}`
    return this.activeSlots.has(slotId)
  }

  /**
   * Clear queue (useful for testing/cleanup)
   */
  clearQueue(): void {
    for (const request of this.queue) {
      request.reject(new Error('Queue cleared'))
    }
    this.queue = []
  }

  /**
   * Get queue metrics for monitoring
   */
  getQueueMetrics(): {
    length: number
    oldestWaitTime: number
    averageWaitTime: number
  } {
    const now = Date.now()
    const waitTimes = this.queue.map((req) => now - req.timestamp)

    return {
      length: this.queue.length,
      oldestWaitTime: waitTimes.length > 0 ? Math.max(...waitTimes) : 0,
      averageWaitTime:
        waitTimes.length > 0
          ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length
          : 0,
    }
  }

  /**
   * Emit concurrency slot event
   */
  private emitSlotEvent(
    type: 'concurrency:acquired' | 'concurrency:released',
    runId: string,
    phase: PhaseName,
    activeCount: number,
  ): void {
    if (!this.eventBus) return

    const event: ExecutionEvent = {
      type,
      runId,
      timestamp: new Date().toISOString(),
      phase,
      data: {
        activeSlots: activeCount,
        maxSlots: this.maxSlots,
        queueLength: this.queue.length,
      },
    }

    this.eventBus.emit(event)
  }

  /**
   * Emit queue event
   */
  private emitQueueEvent(
    type: 'concurrency:queued' | 'concurrency:dequeued',
    runId: string,
    phase: PhaseName,
    queueLength: number,
  ): void {
    if (!this.eventBus) return

    const event: ExecutionEvent = {
      type,
      runId,
      timestamp: new Date().toISOString(),
      phase,
      data: {
        queueLength,
        maxSlots: this.maxSlots,
      },
    }

    this.eventBus.emit(event)
  }
}
