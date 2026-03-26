/**
 * Webhook Receiver for E2E Testing
 *
 * A local HTTP server that captures webhook POST requests.
 *
 * Requirements: 10.1–10.8
 */

import http from 'http'
import type { WebhookPayload } from '@/infrastructure/webhook-dispatcher'

/**
 * Received webhook payload with metadata
 */
export interface WebhookReceivedPayload {
  /** The webhook payload body */
  body: WebhookPayload
  /** Request headers */
  headers: Record<string, string>
  /** When the webhook was received */
  receivedAt: Date
}

/**
 * Local HTTP server that captures webhook POST requests
 */
export class WebhookReceiver {
  private server: http.Server | null = null
  private receivedPayloads: WebhookReceivedPayload[] = []
  private port: number = 0
  private responseCode: number = 200
  private responseDelay: number = 0

  /**
   * Start the receiver on an OS-assigned port
   * @returns Promise resolving to the assigned port number
   */
  async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res)
      })

      this.server.listen(0, '127.0.0.1', () => {
        const address = this.server?.address()
        if (address && typeof address === 'object') {
          this.port = address.port
          resolve(this.port)
        } else {
          reject(new Error('Failed to get server address'))
        }
      })

      this.server.on('error', reject)
    })
  }

  /**
   * Stop the receiver
   */
  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null
          resolve()
        })
      } else {
        resolve()
      }
    })
  }

  /**
   * Get the receiver URL
   * @returns Full URL for webhook configuration
   */
  getUrl(): string {
    return `http://127.0.0.1:${this.port}/webhook`
  }

  /**
   * Get all received payloads
   * @returns Array of received webhook payloads
   */
  getPayloads(): WebhookReceivedPayload[] {
    return [...this.receivedPayloads]
  }

  /**
   * Get payloads filtered by event type
   * @param event - Event type to filter by
   * @returns Array of matching payloads
   */
  getByEvent(event: string): WebhookReceivedPayload[] {
    return this.receivedPayloads.filter((p) => p.body.event === event)
  }

  /**
   * Configure response behavior (e.g., return 5xx for retry testing)
   * @param code - HTTP response code
   */
  setResponseCode(code: number): void {
    this.responseCode = code
  }

  /**
   * Configure a delay before responding (for timeout testing)
   * @param ms - Delay in milliseconds
   */
  setResponseDelay(ms: number): void {
    this.responseDelay = ms
  }

  /**
   * Clear received payloads
   */
  clear(): void {
    this.receivedPayloads = []
  }

  /**
   * Handle incoming HTTP request
   * @param req - HTTP request
   * @param res - HTTP response
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    // Only accept POST requests
    if (req.method !== 'POST') {
      res.writeHead(405)
      res.end('Method not allowed')
      return
    }

    // Collect body
    let body = ''
    req.on('data', (chunk) => {
      body += chunk.toString()
    })

    req.on('end', async () => {
      try {
        // Apply delay if configured
        if (this.responseDelay > 0) {
          await this.sleep(this.responseDelay)
        }

        // Parse payload
        const payload = JSON.parse(body) as WebhookPayload

        // Collect headers
        const headers: Record<string, string> = {}
        for (const [key, value] of Object.entries(req.headers)) {
          if (value !== undefined) {
            headers[key] = Array.isArray(value) ? value.join(', ') : value
          }
        }

        // Store payload
        this.receivedPayloads.push({
          body: payload,
          headers,
          receivedAt: new Date(),
        })

        // Send response
        res.writeHead(this.responseCode, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ received: true }))
      } catch (error) {
        res.writeHead(400)
        res.end('Bad request')
      }
    })
  }

  /**
   * Sleep for specified milliseconds
   * @param ms - Milliseconds to sleep
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
