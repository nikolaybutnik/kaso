/**
 * Webhook Receiver for E2E Testing
 *
 * Local HTTP server that captures webhook POST requests from the
 * WebhookDispatcher and records payloads for verification.
 *
 * Requirements: 10.1–10.8
 */

import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'http'
import type { WebhookPayload } from '@/infrastructure/webhook-dispatcher'

/** Captured webhook delivery with metadata */
export interface WebhookReceivedPayload {
  body: WebhookPayload
  headers: Record<string, string>
  receivedAt: Date
}

/**
 * Local HTTP server that receives and records webhook POST requests.
 * Uses port 0 for OS-assigned port to avoid EADDRINUSE conflicts.
 */
export class WebhookReceiver {
  private server: Server | null = null
  private receivedPayloads: WebhookReceivedPayload[] = []
  private port = 0
  private responseCode = 200

  /** Start the receiver on an OS-assigned port */
  async start(): Promise<number> {
    if (this.server) {
      throw new Error('WebhookReceiver is already running')
    }

    this.server = createServer((req, res) => this.handleRequest(req, res))

    return new Promise<number>((resolve, reject) => {
      this.server!.listen(0, '127.0.0.1', () => {
        const address = this.server!.address()
        if (address && typeof address === 'object') {
          this.port = address.port
          resolve(this.port)
        } else {
          reject(new Error('Failed to get server address'))
        }
      })

      this.server!.on('error', reject)
    })
  }

  /** Stop the receiver and close all connections */
  async stop(): Promise<void> {
    if (!this.server) return

    return new Promise<void>((resolve) => {
      this.server!.close(() => {
        this.server = null
        this.port = 0
        resolve()
      })
    })
  }

  /** Get the receiver URL (e.g. http://127.0.0.1:12345) */
  getUrl(): string {
    if (!this.server || this.port === 0) {
      throw new Error('WebhookReceiver is not running')
    }
    return `http://127.0.0.1:${this.port}`
  }

  /** Get all received payloads */
  getPayloads(): WebhookReceivedPayload[] {
    return [...this.receivedPayloads]
  }

  /** Get payloads filtered by event type */
  getByEvent(event: string): WebhookReceivedPayload[] {
    return this.receivedPayloads.filter((p) => p.body.event === event)
  }

  /** Configure response status code (e.g. 500 for retry testing) */
  setResponseCode(code: number): void {
    this.responseCode = code
  }

  /** Clear all received payloads */
  clear(): void {
    this.receivedPayloads = []
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'text/plain' })
      res.end('Method Not Allowed')
      return
    }

    const chunks: Buffer[] = []

    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })

    req.on('end', () => {
      try {
        const rawBody = Buffer.concat(chunks).toString('utf-8')
        const body = JSON.parse(rawBody) as WebhookPayload

        const headers: Record<string, string> = {}
        for (const [key, value] of Object.entries(req.headers)) {
          if (typeof value === 'string') {
            headers[key] = value
          } else if (Array.isArray(value)) {
            headers[key] = value.join(', ')
          }
        }

        this.receivedPayloads.push({
          body,
          headers,
          receivedAt: new Date(),
        })

        res.writeHead(this.responseCode, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ received: true }))
      } catch {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('Bad Request')
      }
    })
  }
}
