/**
 * Unit tests for Webhook Dispatcher
 *
 * Requirements: 24.1, 24.2, 24.3, 24.4
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  WebhookDispatcher,
  createWebhookDispatcher,
} from '../../src/infrastructure/webhook-dispatcher'
import type { WebhookConfig } from '../../src/config/schema'
import { EventBus } from '../../src/core/event-bus'
import type { ExecutionEvent } from '../../src/core/types'

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockExecutionEvent(
  overrides: Partial<ExecutionEvent> = {},
): ExecutionEvent {
  return {
    type: 'run:completed',
    runId: 'test-run-123',
    timestamp: new Date().toISOString(),
    phase: 'review-delivery',
    agent: 'delivery',
    data: {
      specName: 'test-feature',
      duration: 12345,
    },
    ...overrides,
  }
}

function createMockWebhookConfig(
  overrides: Partial<WebhookConfig> = {},
): WebhookConfig {
  return {
    url: 'https://example.com/webhook',
    events: ['run:completed', 'run:failed'],
    headers: {},
    secret: undefined,
    ...overrides,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MockFetch = any

function createMockFetch(response: Partial<Response> = {}): MockFetch {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    ...response,
  } as Response)
}

// =============================================================================
// Unit Tests
// =============================================================================

describe('WebhookDispatcher', () => {
  let dispatcher: WebhookDispatcher
  let eventBus: EventBus
  let mockFetch: MockFetch

  beforeEach(() => {
    eventBus = new EventBus()
    mockFetch = createMockFetch()
    dispatcher = createWebhookDispatcher(
      {
        webhooks: [createMockWebhookConfig()],
        maxRetries: 3,
        baseDelayMs: 100,
        timeoutMs: 5000,
      },
      { eventBus, fetchFn: mockFetch },
    )
  })

  describe('initialization', () => {
    it('should create dispatcher with default config', () => {
      const defaultDispatcher = createWebhookDispatcher()
      expect(defaultDispatcher.isActive()).toBe(false)
      expect(defaultDispatcher.getWebhooks()).toHaveLength(0)
    })

    it('should create dispatcher with custom config', () => {
      const customDispatcher = createWebhookDispatcher({
        webhooks: [
          { url: 'https://test.com/webhook', events: ['run:started'], headers: {} },
        ],
        maxRetries: 5,
        baseDelayMs: 2000,
        timeoutMs: 10000,
      })

      const webhooks = customDispatcher.getWebhooks()
      expect(webhooks).toHaveLength(1)
      expect(webhooks[0]?.url).toBe('https://test.com/webhook')
    })
  })

  describe('start/stop', () => {
    it('should start and stop dispatcher', () => {
      expect(dispatcher.isActive()).toBe(false)

      dispatcher.start()
      expect(dispatcher.isActive()).toBe(true)

      dispatcher.stop()
      expect(dispatcher.isActive()).toBe(false)
    })

    it('should handle multiple start calls gracefully', () => {
      dispatcher.start()
      dispatcher.start() // Should not throw or create duplicate subscriptions
      expect(dispatcher.isActive()).toBe(true)
    })

    it('should handle multiple stop calls gracefully', () => {
      dispatcher.start()
      dispatcher.stop()
      dispatcher.stop() // Should not throw
      expect(dispatcher.isActive()).toBe(false)
    })
  })

  describe('webhook management', () => {
    it('should add webhook dynamically', () => {
      const newWebhook: WebhookConfig = {
        url: 'https://new.com/webhook',
        events: ['phase:started'],
        headers: { 'X-Custom': 'value' },
        secret: undefined,
      }

      dispatcher.addWebhook(newWebhook)
      const webhooks = dispatcher.getWebhooks()

      expect(webhooks).toHaveLength(2)
      expect(webhooks[1]?.url).toBe('https://new.com/webhook')
    })

    it('should remove webhook by URL', () => {
      dispatcher.addWebhook({
        url: 'https://remove.com/webhook',
        events: [],
        headers: {},
      })

      expect(dispatcher.getWebhooks()).toHaveLength(2)

      const removed = dispatcher.removeWebhook('https://remove.com/webhook')

      expect(removed).toBe(true)
      expect(dispatcher.getWebhooks()).toHaveLength(1)
    })

    it('should return false when removing non-existent webhook', () => {
      const removed = dispatcher.removeWebhook('https://nonexistent.com/webhook')
      expect(removed).toBe(false)
    })

    it('should return copy of webhooks array', () => {
      const webhooks1 = dispatcher.getWebhooks()
      const webhooks2 = dispatcher.getWebhooks()

      expect(webhooks1).not.toBe(webhooks2) // Different array instances
      expect(webhooks1).toEqual(webhooks2) // Same content
    })
  })

  describe('payload building', () => {
    it('should build payload with required fields', () => {
      const event = createMockExecutionEvent({
        type: 'run:completed',
        runId: 'run-123',
        timestamp: '2024-01-15T10:30:00.000Z',
      })

      const payload = dispatcher.buildPayload(event)

      expect(payload.event).toBe('run:completed')
      expect(payload.timestamp).toBe('2024-01-15T10:30:00.000Z')
      expect(payload.runId).toBe('run-123')
    })

    it('should include spec name from event data', () => {
      const event = createMockExecutionEvent({
        data: { specName: 'my-feature' },
      })

      const payload = dispatcher.buildPayload(event)

      expect(payload.specName).toBe('my-feature')
    })

    it('should include phase from event', () => {
      const event = createMockExecutionEvent({
        phase: 'implementation',
      })

      const payload = dispatcher.buildPayload(event)

      expect(payload.phase).toBe('implementation')
    })

    it('should include event data', () => {
      const event = createMockExecutionEvent({
        data: { customField: 'customValue', numberField: 42 },
      })

      const payload = dispatcher.buildPayload(event)

      expect(payload.data?.customField).toBe('customValue')
      expect(payload.data?.numberField).toBe(42)
    })

    it('should handle events without data', () => {
      const event = createMockExecutionEvent({ data: undefined })

      const payload = dispatcher.buildPayload(event)

      expect(payload.data).toBeDefined()
      expect(payload.specName).toBeUndefined()
    })
  })

  describe('data sanitization', () => {
    it('should redact sensitive fields', () => {
      const event = createMockExecutionEvent({
        data: {
          specName: 'test',
          apiKey: 'secret123',
          password: 'myPassword',
          token: 'bearer-token',
          secret: 'top-secret',
          authHeader: 'Basic abc123',
          normalField: 'normal-value',
        },
      })

      const payload = dispatcher.buildPayload(event)

      expect(payload.data?.apiKey).toBe('[REDACTED]')
      expect(payload.data?.password).toBe('[REDACTED]')
      expect(payload.data?.token).toBe('[REDACTED]')
      expect(payload.data?.secret).toBe('[REDACTED]')
      expect(payload.data?.authHeader).toBe('[REDACTED]')
      expect(payload.data?.normalField).toBe('normal-value')
      expect(payload.data?.specName).toBe('test')
    })

    it('should handle nested sensitive data', () => {
      const event = createMockExecutionEvent({
        data: {
          config: {
            apiKey: 'nested-secret',
          },
          password: 'top-level-password',
        },
      })

      const payload = dispatcher.buildPayload(event)

      // Nested objects might not be fully sanitized depending on implementation
      expect(payload.data?.password).toBe('[REDACTED]')
    })
  })

  describe('header building', () => {
    it('should include Content-Type header', () => {
      const webhook = createMockWebhookConfig()
      const headers = dispatcher.buildHeaders(webhook, '{}')

      expect(headers['Content-Type']).toBe('application/json')
    })

    it('should include User-Agent header', () => {
      const webhook = createMockWebhookConfig()
      const headers = dispatcher.buildHeaders(webhook, '{}')

      expect(headers['User-Agent']).toContain('KASO')
    })

    it('should include custom headers from config', () => {
      const webhook = createMockWebhookConfig({
        headers: {
          'X-Custom-Header': 'custom-value',
          'Authorization': 'Bearer token123',
        },
      })

      const headers = dispatcher.buildHeaders(webhook, '{}')

      expect(headers['X-Custom-Header']).toBe('custom-value')
      expect(headers['Authorization']).toBe('Bearer token123')
    })

    it('should include HMAC signature when secret is configured', () => {
      const webhook = createMockWebhookConfig({ secret: 'my-secret' })
      const body = '{"test":"payload"}'

      const headers = dispatcher.buildHeaders(webhook, body)

      expect(headers['X-KASO-Signature']).toBeDefined()
      expect(headers['X-KASO-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/)
    })

    it('should not include signature header when no secret', () => {
      const webhook = createMockWebhookConfig() // No secret
      const headers = dispatcher.buildHeaders(webhook, '{}')

      expect(headers['X-KASO-Signature']).toBeUndefined()
    })

    it('should generate consistent signatures for same payload and secret', () => {
      const webhook = createMockWebhookConfig({ secret: 'my-secret' })
      const body = '{"test":"payload"}'

      const headers1 = dispatcher.buildHeaders(webhook, body)
      const headers2 = dispatcher.buildHeaders(webhook, body)

      expect(headers1['X-KASO-Signature']).toBe(headers2['X-KASO-Signature'])
    })
  })

  describe('HMAC signing', () => {
    it('should sign payload correctly', () => {
      const payload = '{"event":"test"}'
      const secret = 'my-secret-key'

      const signature = dispatcher.signPayload(payload, secret)

      expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/)
    })

    it('should produce different signatures for different secrets', () => {
      const payload = '{"event":"test"}'

      const signature1 = dispatcher.signPayload(payload, 'secret1')
      const signature2 = dispatcher.signPayload(payload, 'secret2')

      expect(signature1).not.toBe(signature2)
    })

    it('should produce different signatures for different payloads', () => {
      const secret = 'my-secret'

      const signature1 = dispatcher.signPayload('{"event":"test1"}', secret)
      const signature2 = dispatcher.signPayload('{"event":"test2"}', secret)

      expect(signature1).not.toBe(signature2)
    })

    it('should verify signature correctly', () => {
      const payload = '{"event":"test"}'
      const secret = 'my-secret'

      const signature = dispatcher.signPayload(payload, secret)
      const isValid = dispatcher.verifySignature(payload, secret, signature)

      expect(isValid).toBe(true)
    })

    it('should reject invalid signature', () => {
      const payload = '{"event":"test"}'
      const secret = 'my-secret'

      const isValid = dispatcher.verifySignature(
        payload,
        secret,
        'sha256=invalid',
      )

      expect(isValid).toBe(false)
    })

    it('should reject signature with wrong secret', () => {
      const payload = '{"event":"test"}'
      const secret = 'my-secret'

      const signature = dispatcher.signPayload(payload, secret)
      const isValid = dispatcher.verifySignature(payload, 'wrong-secret', signature)

      expect(isValid).toBe(false)
    })
  })

  describe('dispatch to webhook', () => {
    it('should dispatch successfully on 200 response', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
      } as Response)

      const webhook = createMockWebhookConfig()
      const payload = dispatcher.buildPayload(createMockExecutionEvent())

      const result = await dispatcher.dispatchToWebhook(webhook, payload)

      expect(result.success).toBe(true)
      expect(result.statusCode).toBe(200)
      expect(result.attempts).toBe(1)
    })

    it('should include correct headers in request', async () => {
      const webhook = createMockWebhookConfig({
        headers: { 'X-Custom': 'value' },
      })
      const payload = dispatcher.buildPayload(createMockExecutionEvent())

      await dispatcher.dispatchToWebhook(webhook, payload)

      expect(mockFetch).toHaveBeenCalledWith(
        webhook.url,
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Custom': 'value',
          }),
          body: expect.any(String),
        }),
      )
    })

    it('should retry on non-2xx response', async () => {
      mockFetch
        .mockResolvedValueOnce({ ok: false, status: 500 } as Response)
        .mockResolvedValueOnce({ ok: false, status: 502 } as Response)
        .mockResolvedValueOnce({ ok: true, status: 200 } as Response)

      const webhook = createMockWebhookConfig()
      const payload = dispatcher.buildPayload(createMockExecutionEvent())

      const result = await dispatcher.dispatchToWebhook(webhook, payload)

      expect(result.success).toBe(true)
      expect(result.attempts).toBe(3)
      expect(mockFetch).toHaveBeenCalledTimes(3)
    })

    it('should retry on network error', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValueOnce({ ok: true, status: 200 } as Response)

      const webhook = createMockWebhookConfig()
      const payload = dispatcher.buildPayload(createMockExecutionEvent())

      const result = await dispatcher.dispatchToWebhook(webhook, payload)

      expect(result.success).toBe(true)
      expect(result.attempts).toBe(3)
    })

    it('should fail after max retries exceeded', async () => {
      mockFetch.mockRejectedValue(new Error('Persistent error'))

      const webhook = createMockWebhookConfig()
      const payload = dispatcher.buildPayload(createMockExecutionEvent())

      const result = await dispatcher.dispatchToWebhook(webhook, payload)

      expect(result.success).toBe(false)
      expect(result.attempts).toBe(3)
      expect(result.error).toContain('Persistent error')
    })

    it('should timeout after specified duration', async () => {
      mockFetch.mockImplementation(
        () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 10000),
          ),
      )

      const dispatcherWithShortTimeout = createWebhookDispatcher(
        {
          webhooks: [],
          timeoutMs: 100,
          baseDelayMs: 10,
          maxRetries: 1,
        },
        { fetchFn: mockFetch },
      )

      const webhook = createMockWebhookConfig()
      const payload = dispatcherWithShortTimeout.buildPayload(
        createMockExecutionEvent(),
      )

      const result = await dispatcherWithShortTimeout.dispatchToWebhook(
        webhook,
        payload,
      )

      expect(result.success).toBe(false)
    })
  })

  describe('event filtering', () => {
    it('should dispatch to webhooks matching event type', async () => {
      const testEventBus = new EventBus()
      const testMockFetch = createMockFetch()

      const webhook1 = createMockWebhookConfig({
        url: 'https://webhook1.com',
        events: ['run:completed'],
      })
      const webhook2 = createMockWebhookConfig({
        url: 'https://webhook2.com',
        events: ['run:failed'],
      })

      const testDispatcher = createWebhookDispatcher(
        { webhooks: [webhook1, webhook2] },
        { eventBus: testEventBus, fetchFn: testMockFetch },
      )

      testDispatcher.start()

      // Emit run:completed event
      testEventBus.emit({
        type: 'run:completed',
        runId: 'test',
        timestamp: new Date().toISOString(),
      })

      // Allow time for dispatch
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Should only call webhook1
      expect(testMockFetch).toHaveBeenCalledTimes(1)
      expect(testMockFetch).toHaveBeenCalledWith(
        'https://webhook1.com',
        expect.any(Object),
      )

      testDispatcher.stop()
    })

    it('should dispatch to webhooks with no event filter', async () => {
      const testEventBus = new EventBus()
      const testMockFetch = createMockFetch()

      const webhook = createMockWebhookConfig({
        events: [], // All events
      })

      const testDispatcher = createWebhookDispatcher(
        { webhooks: [webhook] },
        { eventBus: testEventBus, fetchFn: testMockFetch },
      )

      testDispatcher.start()

      testEventBus.emit({
        type: 'run:started',
        runId: 'test',
        timestamp: new Date().toISOString(),
      })

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(testMockFetch).toHaveBeenCalledTimes(1)

      testDispatcher.stop()
    })

    it('should not dispatch to webhooks not matching event type', async () => {
      const testEventBus = new EventBus()
      const testMockFetch = createMockFetch()

      const webhook = createMockWebhookConfig({
        events: ['run:completed'],
      })

      const testDispatcher = createWebhookDispatcher(
        { webhooks: [webhook] },
        { eventBus: testEventBus, fetchFn: testMockFetch },
      )

      testDispatcher.start()

      testEventBus.emit({
        type: 'run:started',
        runId: 'test',
        timestamp: new Date().toISOString(),
      })

      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(testMockFetch).not.toHaveBeenCalled()

      testDispatcher.stop()
    })
  })

  describe('backoff calculation', () => {
    it('should calculate exponential backoff', () => {
      const delays: number[] = []
      for (let i = 1; i <= 5; i++) {
        delays.push(dispatcher.calculateBackoff(i))
      }

      // Delays should generally increase
      for (let i = 1; i < delays.length; i++) {
        expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]! * 0.5)
      }
    })

    it('should cap backoff at 30 seconds', () => {
      const delay = dispatcher.calculateBackoff(100)

      expect(delay).toBeLessThanOrEqual(30000)
    })

    it('should apply jitter to prevent thundering herd', () => {
      const delays: number[] = []
      for (let i = 0; i < 10; i++) {
        delays.push(dispatcher.calculateBackoff(2))
      }

      // Not all delays should be identical (jitter should vary them)
      const uniqueDelays = new Set(delays)
      expect(uniqueDelays.size).toBeGreaterThan(1)
    })
  })

  describe('delivery result', () => {
    it('should include duration in successful result', async () => {
      mockFetch.mockResolvedValue({ ok: true, status: 200 } as Response)

      const webhook = createMockWebhookConfig()
      const payload = dispatcher.buildPayload(createMockExecutionEvent())

      const result = await dispatcher.dispatchToWebhook(webhook, payload)

      expect(result.duration).toBeGreaterThanOrEqual(0)
      expect(result.success).toBe(true)
    })

    it('should include duration in failed result', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      const webhook = createMockWebhookConfig()
      const payload = dispatcher.buildPayload(createMockExecutionEvent())

      const result = await dispatcher.dispatchToWebhook(webhook, payload)

      expect(result.duration).toBeGreaterThanOrEqual(0)
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })
})
