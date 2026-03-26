/**
 * Event Collector for E2E Testing
 *
 * Subscribes to EventBus.onAny() and accumulates all emitted
 * ExecutionEvents for assertion in E2E tests.
 *
 * Requirements: 3.4, 9.1, 9.4
 */

import type { EventBus, UnsubscribeFunction } from '@/core/event-bus'
import type { EventType, ExecutionEvent, PhaseName } from '@/core/types'

/**
 * Collects and queries execution events from the EventBus
 */
export class EventCollector {
  private events: ExecutionEvent[] = []
  private unsubscribe: UnsubscribeFunction

  constructor(eventBus: EventBus) {
    this.unsubscribe = eventBus.onAny((event) => {
      this.events.push(event)
    })
  }

  /** Get all collected events */
  getEvents(): ExecutionEvent[] {
    return [...this.events]
  }

  /** Get events filtered by type */
  getByType(type: EventType): ExecutionEvent[] {
    return this.events.filter((e) => e.type === type)
  }

  /** Get events filtered by run ID */
  getByRunId(runId: string): ExecutionEvent[] {
    return this.events.filter((e) => e.runId === runId)
  }

  /** Get events for a specific phase */
  getByPhase(phase: PhaseName): ExecutionEvent[] {
    return this.events.filter((e) => e.phase === phase)
  }

  /**
   * Assert minimum event count for a type
   * @throws Error if fewer than `min` events of the given type exist
   */
  assertMinCount(type: EventType, min: number): void {
    const count = this.getByType(type).length
    if (count < min) {
      throw new Error(`Expected at least ${min} '${type}' events, got ${count}`)
    }
  }

  /**
   * Assert that the first occurrence of `before` appears before the first occurrence of `after`
   * @throws Error if ordering is violated or either event type is missing
   */
  assertOrdering(before: EventType, after: EventType): void {
    const beforeIdx = this.events.findIndex((e) => e.type === before)
    const afterIdx = this.events.findIndex((e) => e.type === after)

    if (beforeIdx === -1) {
      throw new Error(`Event '${before}' not found`)
    }
    if (afterIdx === -1) {
      throw new Error(`Event '${after}' not found`)
    }
    if (beforeIdx >= afterIdx) {
      throw new Error(
        `Expected '${before}' (index ${beforeIdx}) before '${after}' (index ${afterIdx})`,
      )
    }
  }

  /**
   * Wait for a specific event type, resolving immediately if already collected
   * @param type - Event type to wait for
   * @param timeoutMs - Maximum wait time (default 5000ms)
   * @returns The matching event
   * @throws Error on timeout
   */
  async waitForEvent(
    type: EventType,
    timeoutMs = 5000,
  ): Promise<ExecutionEvent> {
    const existing = this.events.find((e) => e.type === type)
    if (existing) {
      return existing
    }

    return new Promise<ExecutionEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for '${type}' after ${timeoutMs}ms`))
      }, timeoutMs)

      const checkInterval = setInterval(() => {
        const found = this.events.find((e) => e.type === type)
        if (found) {
          clearTimeout(timer)
          clearInterval(checkInterval)
          resolve(found)
        }
      }, 10)
    })
  }

  /** Clear all collected events */
  clear(): void {
    this.events = []
  }

  /** Unsubscribe from EventBus — stops collecting new events */
  dispose(): void {
    this.unsubscribe()
  }
}
