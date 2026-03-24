/**
 * Webhook Dispatcher for KASO
 * Sends HTTP POST to registered webhook URLs on lifecycle events
 *
 * Requirements: 24.1, 24.2, 24.3, 24.4
 */

import { createHmac } from 'crypto'
import type { ExecutionEvent, EventType } from '../core/types'
import type { WebhookConfig } from '../config/schema'
import { EventBus } from '../core/event-bus'

/** Webhook payload structure */
export interface WebhookPayload {
  event: EventType
  specName?: string
  phase?: string
  timestamp: string
  runId?: string
  data?: Record<string, unknown>
}

/** Webhook delivery result */
export interface WebhookDeliveryResult {
  success: boolean
  statusCode?: number
  error?: string
  attempts: number
  duration: number
}

/** Webhook dispatcher configuration */
export interface WebhookDispatcherConfig {
  webhooks: WebhookConfig[]
  maxRetries: number
  baseDelayMs: number
  timeoutMs: number
}

/** Dependencies for webhook dispatcher */
interface WebhookDispatcherDependencies {
  eventBus?: EventBus
  fetchFn?: typeof fetch
}

/**
 * WebhookDispatcher - Sends HTTP POST to registered webhooks on lifecycle events
 *
 * Features:
 * - Subscribes to event bus and dispatches events to configured webhooks
 * - Includes event type, spec name, phase, timestamp in JSON payload
 * - Supports custom headers from WebhookConfig
 * - Signs payloads with HMAC-SHA256 when secret is configured
 * - Retries failed deliveries with exponential backoff
 */
export class WebhookDispatcher {
  private readonly config: WebhookDispatcherConfig
  private readonly eventBus: EventBus
  private readonly fetchFn: typeof fetch
  private isRunning: boolean = false
  private unsubscribe?: () => void

  constructor(
    config: Partial<WebhookDispatcherConfig> = {},
    deps: WebhookDispatcherDependencies = {},
  ) {
    this.config = {
      webhooks: config.webhooks ?? [],
      maxRetries: config.maxRetries ?? 3,
      baseDelayMs: config.baseDelayMs ?? 1000,
      timeoutMs: config.timeoutMs ?? 10000,
    }
    this.eventBus = deps.eventBus ?? new EventBus()
    this.fetchFn = deps.fetchFn ?? fetch
  }

  /**
   * Start the webhook dispatcher
   * Subscribes to event bus and begins dispatching events
   */
  start(): void {
    if (this.isRunning) {
      return
    }

    this.isRunning = true

    // Subscribe to all events
    this.unsubscribe = this.eventBus.onAny((event) => {
      this.handleEvent(event as ExecutionEvent)
    })
  }

  /**
   * Stop the webhook dispatcher
   */
  stop(): void {
    if (!this.isRunning) {
      return
    }

    this.isRunning = false
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }

  /**
   * Check if dispatcher is running
   */
  isActive(): boolean {
    return this.isRunning
  }

  /**
   * Get configured webhooks
   */
  getWebhooks(): WebhookConfig[] {
    return [...this.config.webhooks]
  }

  /**
   * Add a webhook configuration dynamically
   */
  addWebhook(webhook: WebhookConfig): void {
    this.config.webhooks.push(webhook)
  }

  /**
   * Remove a webhook by URL
   */
  removeWebhook(url: string): boolean {
    const index = this.config.webhooks.findIndex((w) => w.url === url)
    if (index >= 0) {
      this.config.webhooks.splice(index, 1)
      return true
    }
    return false
  }

  // ---------------------------------------------------------------------------
  // Event handling
  // ---------------------------------------------------------------------------

  private handleEvent(event: ExecutionEvent): void {
    // Filter webhooks that are interested in this event type
    const interestedWebhooks = this.config.webhooks.filter((webhook) =>
      this.shouldDispatchToWebhook(event.type, webhook),
    )

    if (interestedWebhooks.length === 0) {
      return
    }

    const payload = this.buildPayload(event)

    // Dispatch to all interested webhooks in parallel
    for (const webhook of interestedWebhooks) {
      this.dispatchToWebhook(webhook, payload).catch(() => {
        // Errors are logged in dispatchToWebhook, ignore here
      })
    }
  }

  private shouldDispatchToWebhook(
    eventType: EventType,
    webhook: WebhookConfig,
  ): boolean {
    // If no events specified, dispatch all events
    if (!webhook.events || webhook.events.length === 0) {
      return true
    }

    return webhook.events.includes(eventType)
  }

  // ---------------------------------------------------------------------------
  // Payload building
  // ---------------------------------------------------------------------------

  /**
   * Build webhook payload from execution event
   */
  buildPayload(event: ExecutionEvent): WebhookPayload {
    const data = event.data ?? {}

    return {
      event: event.type,
      specName: data.specName as string | undefined,
      phase: event.phase,
      timestamp: event.timestamp,
      runId: event.runId,
      data: this.sanitizeData(data),
    }
  }

  /**
   * Sanitize data by removing sensitive fields
   */
  private sanitizeData(
    data: Record<string, unknown>,
  ): Record<string, unknown> {
    const sensitiveFields = ['secret', 'password', 'token', 'key', 'auth']
    const sanitized: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase()
      if (sensitiveFields.some((sf) => lowerKey.includes(sf))) {
        sanitized[key] = '[REDACTED]'
      } else {
        sanitized[key] = value
      }
    }

    return sanitized
  }

  // ---------------------------------------------------------------------------
  // Dispatch and retry logic
  // ---------------------------------------------------------------------------

  /**
   * Dispatch payload to a webhook with retry logic
   */
  async dispatchToWebhook(
    webhook: WebhookConfig,
    payload: WebhookPayload,
  ): Promise<WebhookDeliveryResult> {
    const body = JSON.stringify(payload)
    const headers = this.buildHeaders(webhook, body)

    let lastError: Error | undefined
    let attempts = 0
    const startTime = Date.now()

    while (attempts < this.config.maxRetries) {
      attempts++

      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(
          () => controller.abort(),
          this.config.timeoutMs,
        )

        const response = await this.fetchFn(webhook.url, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        })

        clearTimeout(timeoutId)

        if (response.ok) {
          return {
            success: true,
            statusCode: response.status,
            attempts,
            duration: Date.now() - startTime,
          }
        }

        // Non-2xx response, will retry
        if (attempts < this.config.maxRetries) {
          await this.delay(this.calculateBackoff(attempts))
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))

        if (attempts < this.config.maxRetries) {
          await this.delay(this.calculateBackoff(attempts))
        }
      }
    }

    // All retries exhausted
    return {
      success: false,
      error: lastError?.message ?? 'Unknown error',
      attempts,
      duration: Date.now() - startTime,
    }
  }

  /**
   * Build request headers including custom headers and signature
   */
  buildHeaders(
    webhook: WebhookConfig,
    body: string,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'KASO-WebhookDispatcher/0.1.0',
      ...webhook.headers,
    }

    // Add HMAC-SHA256 signature if secret is configured
    if (webhook.secret) {
      const signature = this.signPayload(body, webhook.secret)
      headers['X-KASO-Signature'] = signature
    }

    return headers
  }

  /**
   * Sign payload with HMAC-SHA256
   */
  signPayload(payload: string, secret: string): string {
    const hmac = createHmac('sha256', secret)
    hmac.update(payload)
    return `sha256=${hmac.digest('hex')}`
  }

  /**
   * Verify payload signature (for testing/validation)
   */
  verifySignature(payload: string, secret: string, signature: string): boolean {
    const expectedSignature = this.signPayload(payload, secret)
    return signature === expectedSignature
  }

  /**
   * Calculate exponential backoff delay
   */
  calculateBackoff(attempt: number): number {
    // Exponential backoff: baseDelay * 2^(attempt-1)
    // With jitter: add randomness to prevent thundering herd
    const baseDelay = this.config.baseDelayMs * Math.pow(2, attempt - 1)
    const jitter = Math.random() * 0.3 * baseDelay // 30% jitter
    return Math.min(baseDelay + jitter, 30000) // Cap at 30 seconds
  }

  /**
   * Delay for specified milliseconds
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

// =============================================================================
// Factory function
// =============================================================================

/**
 * Create a new WebhookDispatcher instance
 */
export function createWebhookDispatcher(
  config?: Partial<WebhookDispatcherConfig>,
  deps?: WebhookDispatcherDependencies,
): WebhookDispatcher {
  return new WebhookDispatcher(config, deps)
}
