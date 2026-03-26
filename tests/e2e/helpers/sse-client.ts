/**
 * SSE Client for E2E Testing
 *
 * Test HTTP client that connects to the SSE endpoint and collects events.
 *
 * Requirements: 9.2, 9.5, 9.6, 9.7, 9.8
 */

import http from 'http'
import type { EventType } from '@/core/types'

/**
 * SSE message structure
 */
export interface SSEReceivedEvent {
  /** Event ID for replay */
  id?: string
  /** Event type */
  type?: string
  /** Raw event data */
  data: string
  /** Parsed JSON data */
  parsed?: unknown
}

/**
 * Options for SSE connection
 */
export interface SSEConnectOptions {
  /** Filter events by run ID */
  runId?: string
  /** Last event ID for replay */
  lastEventId?: string
  /** Authentication token */
  authToken?: string
}

/**
 * Test HTTP client that connects to the SSE endpoint
 */
export class SSEClient {
  private receivedEvents: SSEReceivedEvent[] = []
  private request: http.ClientRequest | null = null
  private baseUrl: string
  private isConnected = false

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  /**
   * Connect to the SSE endpoint with optional filters
   * @param options - Connection options
   */
  async connect(options: SSEConnectOptions = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      // Build URL with query params
      const url = new URL('/events', this.baseUrl)
      if (options.runId) {
        url.searchParams.set('runId', options.runId)
      }

      const headers: Record<string, string> = {}
      if (options.lastEventId) {
        headers['Last-Event-ID'] = options.lastEventId
      }
      if (options.authToken) {
        headers['Authorization'] = `Bearer ${options.authToken}`
      }

      this.request = http.get(
        url.toString(),
        { headers },
        (res) => {
          if (res.statusCode === 401) {
            reject(new Error('Unauthorized'))
            return
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Unexpected status code: ${res.statusCode}`))
            return
          }

          this.isConnected = true

          let buffer = ''
          res.on('data', (chunk: Buffer) => {
            buffer += chunk.toString()

            // Parse SSE format (event lines separated by double newline)
            const lines = buffer.split('\n')
            let currentEvent: Partial<SSEReceivedEvent> = {}

            for (let i = 0; i < lines.length; i++) {
              const line = lines[i]
              if (line === undefined) continue

              if (line.startsWith('id:')) {
                currentEvent.id = line.slice(3).trim()
              } else if (line.startsWith('event:')) {
                currentEvent.type = line.slice(6).trim()
              } else if (line.startsWith('data:')) {
                currentEvent.data = line.slice(5).trim()
              } else if (line === '' && currentEvent.data) {
                // End of event
                try {
                  currentEvent.parsed = JSON.parse(currentEvent.data)
                } catch {
                  // Data is not JSON, keep as string
                }
                this.receivedEvents.push(currentEvent as SSEReceivedEvent)
                currentEvent = {}
              }
            }

            // Keep incomplete line in buffer
            const lastNewline = buffer.lastIndexOf('\n')
            if (lastNewline >= 0) {
              buffer = buffer.slice(lastNewline + 1)
            }
          })

          res.on('end', () => {
            this.isConnected = false
          })

          res.on('error', (err) => {
            this.isConnected = false
            reject(err)
          })

          // Give time for connection to establish
          setTimeout(resolve, 100)
        },
      )

      this.request.on('error', reject)
    })
  }

  /**
   * Disconnect from the SSE endpoint
   */
  disconnect(): void {
    if (this.request) {
      this.request.destroy()
      this.request = null
    }
    this.isConnected = false
  }

  /**
   * Get all received events
   * @returns Array of received events
   */
  getEvents(): SSEReceivedEvent[] {
    return [...this.receivedEvents]
  }

  /**
   * Wait for a specific event type (with timeout)
   * @param type - Event type to wait for
   * @param timeoutMs - Timeout in milliseconds
   * @returns Promise resolving to the event
   */
  async waitForEvent(type: EventType, timeoutMs = 5000): Promise<SSEReceivedEvent> {
    return new Promise((resolve, reject) => {
      // Check if already have the event
      const existing = this.receivedEvents.find((e) => e.type === type)
      if (existing) {
        resolve(existing)
        return
      }

      // Poll for event
      const checkInterval = setInterval(() => {
        const event = this.receivedEvents.find((e) => e.type === type)
        if (event) {
          clearInterval(checkInterval)
          clearTimeout(timeout)
          resolve(event)
        }
      }, 50)

      // Timeout
      const timeout = setTimeout(() => {
        clearInterval(checkInterval)
        reject(new Error(`Timeout waiting for event type '${type}' after ${timeoutMs}ms`))
      }, timeoutMs)
    })
  }

  /**
   * Clear received events
   */
  clear(): void {
    this.receivedEvents = []
  }

  /**
   * Check if client is connected
   * @returns True if connected
   */
  isConnectedToServer(): boolean {
    return this.isConnected
  }
}
