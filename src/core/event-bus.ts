import { EventType, ExecutionEvent } from './types'

/**
 * Unsubscribe function returned by event listeners
 */
export type UnsubscribeFunction = () => void

/**
 * Event listener callback type
 */
export type EventListener = (event: ExecutionEvent) => void | Promise<void>

/**
 * Event bus for typed pub/sub with ExecutionEvent
 * Supports all EventType variants
 */
export class EventBus {
  private listeners: Map<EventType, Set<EventListener>> = new Map()
  private anyListeners: Set<EventListener> = new Set()
  private eventHistory: ExecutionEvent[] = []
  private maxHistorySize: number

  constructor(maxHistorySize: number = 10000) {
    this.maxHistorySize = maxHistorySize
  }

  /**
   * Subscribe to a specific event type
   * Returns an unsubscribe function for cleanup
   */
  on(eventType: EventType, listener: EventListener): UnsubscribeFunction {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set())
    }
    this.listeners.get(eventType)!.add(listener)

    // Return unsubscribe function
    return () => {
      const listeners = this.listeners.get(eventType)
      if (listeners) {
        listeners.delete(listener)
        if (listeners.size === 0) {
          this.listeners.delete(eventType)
        }
      }
    }
  }

  /**
   * Subscribe to all events
   * Returns an unsubscribe function for cleanup
   */
  onAny(listener: EventListener): UnsubscribeFunction {
    this.anyListeners.add(listener)

    // Return unsubscribe function
    return () => {
      this.anyListeners.delete(listener)
    }
  }

  /**
   * Emit an event to all subscribed listeners
   */
  emit(event: ExecutionEvent): void {
    // Add to history
    this.eventHistory.push(event)
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift()
    }

    // Call specific type listeners
    const typeListeners = this.listeners.get(event.type)
    if (typeListeners) {
      for (const listener of typeListeners) {
        try {
          const result = listener(event)
          if (result instanceof Promise) {
            result.catch((error) => {
              console.error(`Error in event listener for ${event.type}:`, error)
            })
          }
        } catch (error) {
          console.error(`Error in event listener for ${event.type}:`, error)
        }
      }
    }

    // Call any listeners
    for (const listener of this.anyListeners) {
      try {
        const result = listener(event)
        if (result instanceof Promise) {
          result.catch((error) => {
            console.error(
              `Error in any event listener for ${event.type}:`,
              error,
            )
          })
        }
      } catch (error) {
        console.error(`Error in any event listener for ${event.type}:`, error)
      }
    }
  }

  /**
   * Get recent events for replay/reconnect scenarios
   */
  getRecentEvents(limit: number = 100): ExecutionEvent[] {
    const startIndex = Math.max(0, this.eventHistory.length - limit)
    return this.eventHistory.slice(startIndex)
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = []
  }

  /**
   * Get listener count for debugging/monitoring
   */
  getListenerCount(eventType?: EventType): number {
    if (eventType) {
      return this.listeners.get(eventType)?.size ?? 0
    }

    let total = this.anyListeners.size
    for (const listeners of this.listeners.values()) {
      total += listeners.size
    }
    return total
  }

  /**
   * Remove all listeners (useful for testing/cleanup)
   */
  removeAllListeners(): void {
    this.listeners.clear()
    this.anyListeners.clear()
  }
}
