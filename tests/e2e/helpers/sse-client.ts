/**
 * SSE Client for E2E Testing
 *
 * Test HTTP client that connects to the SSEServer endpoint and
 * collects streamed events for assertion.
 *
 * Requirements: 9.2, 9.5, 9.6, 9.7, 9.8
 */

import {
  request as httpRequest,
  type ClientRequest,
  type IncomingMessage,
} from 'http'
import type { SSEMessage } from '@/streaming/sse-server'
import type { EventType } from '@/core/types'

/** A single SSE event received by the client */
export interface SSEReceivedEvent {
  id?: string
  type?: string
  data: string
  parsed?: SSEMessage
}

/** Options for connecting to the SSE endpoint */
export interface SSEConnectOptions {
  runId?: string
  lastEventId?: string
  authToken?: string
}

const DEFAULT_WAIT_TIMEOUT_MS = 5000
const EVENT_POLL_INTERVAL_MS = 10

/**
 * Test HTTP client that connects to an SSE endpoint and accumulates events.
 * Supports runId filtering, Last-Event-ID reconnection, and Bearer auth.
 */
export class SSEClient {
  private receivedEvents: SSEReceivedEvent[] = []
  private clientRequest: ClientRequest | null = null
  private response: IncomingMessage | null = null
  private buffer = ''

  constructor(private readonly baseUrl: string) {}

  /** Connect to the SSE endpoint with optional filters */
  async connect(options: SSEConnectOptions = {}): Promise<void> {
    if (this.clientRequest) {
      throw new Error('SSEClient is already connected')
    }

    const url = new URL(this.baseUrl)
    url.pathname = '/events'

    if (options.runId) {
      url.searchParams.set('runId', options.runId)
    }

    return new Promise<void>((resolve, reject) => {
      const headers: Record<string, string> = {
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
      }

      if (options.authToken) {
        headers['Authorization'] = `Bearer ${options.authToken}`
      }

      if (options.lastEventId) {
        headers['Last-Event-ID'] = options.lastEventId
      }

      this.clientRequest = httpRequest(
        url.toString(),
        { method: 'GET', headers },
        (res) => {
          this.response = res

          // Non-200 means auth failure or other error
          if (res.statusCode !== 200) {
            const error = new Error(
              `SSE connection failed with status ${res.statusCode}`,
            )
            this.cleanup()
            reject(error)
            return
          }

          res.setEncoding('utf-8')

          res.on('data', (chunk: string) => {
            this.buffer += chunk
            this.processBuffer()
          })

          res.on('end', () => {
            this.processBuffer()
            this.cleanup()
          })

          res.on('error', () => {
            this.cleanup()
          })

          // Resolve once we get the response headers (connection established)
          resolve()
        },
      )

      this.clientRequest.on('error', (err) => {
        this.cleanup()
        reject(err)
      })

      this.clientRequest.end()
    })
  }

  /** Disconnect from the SSE endpoint */
  disconnect(): void {
    if (this.response) {
      this.response.destroy()
    }
    if (this.clientRequest) {
      this.clientRequest.destroy()
    }
    this.cleanup()
  }

  /** Get all received events */
  getEvents(): SSEReceivedEvent[] {
    return [...this.receivedEvents]
  }

  /**
   * Wait for a specific event type, resolving immediately if already collected
   * @throws Error on timeout
   */
  async waitForEvent(
    type: EventType,
    timeoutMs = DEFAULT_WAIT_TIMEOUT_MS,
  ): Promise<SSEReceivedEvent> {
    const existing = this.receivedEvents.find((e) => e.type === type)
    if (existing) return existing

    return new Promise<SSEReceivedEvent>((resolve, reject) => {
      const timer = setTimeout(() => {
        clearInterval(poller)
        reject(
          new Error(
            `Timeout waiting for SSE event '${type}' after ${timeoutMs}ms`,
          ),
        )
      }, timeoutMs)

      const poller = setInterval(() => {
        const found = this.receivedEvents.find((e) => e.type === type)
        if (found) {
          clearTimeout(timer)
          clearInterval(poller)
          resolve(found)
        }
      }, EVENT_POLL_INTERVAL_MS)
    })
  }

  /** Clear all received events */
  clear(): void {
    this.receivedEvents = []
  }

  /**
   * Parse the SSE text stream buffer into discrete events.
   * SSE spec: events are separated by blank lines, fields are "field: value\n".
   */
  private processBuffer(): void {
    const blocks = this.buffer.split('\n\n')

    // Last element is either empty or an incomplete block — keep it in the buffer
    this.buffer = blocks.pop() ?? ''

    for (const block of blocks) {
      if (!block.trim()) continue

      let id: string | undefined
      let eventType: string | undefined
      const dataLines: string[] = []

      for (const line of block.split('\n')) {
        if (line.startsWith('id: ')) {
          id = line.slice(4)
        } else if (line.startsWith('event: ')) {
          eventType = line.slice(7)
        } else if (line.startsWith('data: ')) {
          dataLines.push(line.slice(6))
        } else if (line === 'data:') {
          dataLines.push('')
        }
      }

      if (dataLines.length === 0) continue

      const data = dataLines.join('\n')
      let parsed: SSEMessage | undefined

      try {
        parsed = JSON.parse(data) as SSEMessage
      } catch {
        // Not all data payloads are JSON (e.g. connected message)
      }

      this.receivedEvents.push({ id, type: eventType, data, parsed })
    }
  }

  private cleanup(): void {
    this.clientRequest = null
    this.response = null
    this.buffer = ''
  }
}
