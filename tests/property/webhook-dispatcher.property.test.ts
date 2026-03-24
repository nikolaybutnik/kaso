/**
 * Property-based tests for Webhook Dispatcher
 *
 * Property Tests:
 * - Property 44: Webhook payload contains required fields and auth headers
 * - Property 45: Webhook retry with exponential backoff
 * - Property 59: Webhook payloads are HMAC-SHA256 signed
 *
 * Requirements: 24.2, 24.3, 24.4
 */

import { describe, expect, it } from 'vitest'
import { test, fc } from '@fast-check/vitest'
import {
  createWebhookDispatcher,
} from '../../src/infrastructure/webhook-dispatcher'
import type { WebhookConfig } from '../../src/config/schema'
import type { ExecutionEvent, EventType } from '../../src/core/types'

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
    ...overrides,
  }
}

// =============================================================================
// Property Tests
// =============================================================================

describe('Webhook Properties', () => {
  /**
   * Property 44: Webhook payload contains required fields and auth headers
   * Validates: Requirements 24.2, 24.3
   */
  test.prop([
    fc.string({ minLength: 5, maxLength: 30 }),
    fc.string({ minLength: 5, maxLength: 30 }),
    fc.constantFrom('run:started', 'run:completed', 'run:failed', 'phase:started'),
  ])(
    'Property 44: Webhook payload contains required fields and auth headers',
    (runId, specName, eventType) => {
      const dispatcher = createWebhookDispatcher()
      const event = createMockExecutionEvent({
        type: eventType as EventType,
        runId,
        phase: 'implementation',
        data: { specName },
      })

      const payload = dispatcher.buildPayload(event)

      // Required fields must be present
      expect(payload.event).toBeDefined()
      expect(payload.timestamp).toBeDefined()

      // Event type must match
      expect(payload.event).toBe(eventType)

      // Timestamp must be valid ISO string
      expect(new Date(payload.timestamp).toISOString()).toBe(payload.timestamp)
    },
  )

  test.prop([
    fc.string({ minLength: 10, maxLength: 100 }),
    fc.string({ minLength: 5, maxLength: 30 }),
  ])(
    'Property 44: Custom headers are included in request',
    (url, headerValue) => {
      const dispatcher = createWebhookDispatcher()
      const webhook = createMockWebhookConfig({
        url: `https://example.com/${url.replace(/[^a-z0-9]/g, '')}`,
        headers: {
          'X-Custom-Header': headerValue,
          'Authorization': 'Bearer token123',
        },
      })

      const headers = dispatcher.buildHeaders(webhook, '{}')

      // Custom headers should be present
      expect(headers['X-Custom-Header']).toBe(headerValue)
      expect(headers['Authorization']).toBe('Bearer token123')

      // Content-Type should be set
      expect(headers['Content-Type']).toBe('application/json')

      // User-Agent should be set
      expect(headers['User-Agent']).toContain('KASO')
    },
  )

  /**
   * Property 45: Webhook retry with exponential backoff
   * Validates: Requirement 24.4
   */
  test.prop([
    fc.integer({ min: 1, max: 5 }),
    fc.integer({ min: 100, max: 5000 }),
  ])(
    'Property 45: Exponential backoff increases with each retry',
    (attempt, baseDelay) => {
      const dispatcher = createWebhookDispatcher({
        baseDelayMs: baseDelay,
      })

      const delays: number[] = []
      for (let i = 1; i <= attempt; i++) {
        delays.push(dispatcher.calculateBackoff(i))
      }

      // Each delay should be greater than or equal to the previous (until cap)
      for (let i = 1; i < delays.length; i++) {
        // Once capped, delays may be equal
        expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]!)
      }

      // First delay should be at least baseDelay
      expect(delays[0]).toBeGreaterThanOrEqual(baseDelay)

      // Delays should be capped at 30 seconds
      for (const delay of delays) {
        expect(delay).toBeLessThanOrEqual(30000)
      }
    },
  )

  test.prop([
    fc.integer({ min: 100, max: 1000 }),
    fc.integer({ min: 1, max: 10 }),
  ])(
    'Property 45: Backoff formula follows exponential pattern',
    (baseDelay, attempt) => {
      const dispatcher = createWebhookDispatcher({
        baseDelayMs: baseDelay,
      })

      const delay = dispatcher.calculateBackoff(attempt)

      // Upper bound: always capped at 30s
      expect(delay).toBeLessThanOrEqual(30000)

      // Lower bound: baseDelay * 2^(attempt-1) * 0.7, but not exceeding cap
      const expectedBase = baseDelay * Math.pow(2, attempt - 1)
      const minExpected = Math.min(expectedBase * 0.7, 30000) // -30% jitter, capped

      expect(delay).toBeGreaterThanOrEqual(minExpected)
    },
  )

  /**
   * Property 59: Webhook payloads are HMAC-SHA256 signed
   * Validates: Requirement 24.3
   */
  test.prop([
    fc.string({ minLength: 1, maxLength: 1000 }),
    fc.string({ minLength: 10, maxLength: 50 }),
  ])(
    'Property 59: Payloads are correctly signed with HMAC-SHA256',
    (payload, secret) => {
      const dispatcher = createWebhookDispatcher()

      const signature = dispatcher.signPayload(payload, secret)

      // Signature should start with sha256=
      expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/)

      // Same payload and secret should produce same signature
      const signature2 = dispatcher.signPayload(payload, secret)
      expect(signature).toBe(signature2)

      // Different secret should produce different signature
      const differentSignature = dispatcher.signPayload(
        payload,
        secret + 'different',
      )
      expect(signature).not.toBe(differentSignature)

      // Different payload should produce different signature
      const differentPayloadSignature = dispatcher.signPayload(
        payload + 'different',
        secret,
      )
      expect(signature).not.toBe(differentPayloadSignature)
    },
  )

  test.prop([
    fc.string({ minLength: 1, maxLength: 1000 }),
    fc.string({ minLength: 10, maxLength: 50 }),
  ])(
    'Property 59: Signatures can be verified',
    (payload, secret) => {
      const dispatcher = createWebhookDispatcher()

      const signature = dispatcher.signPayload(payload, secret)

      // Should verify correctly
      expect(dispatcher.verifySignature(payload, secret, signature)).toBe(true)

      // Wrong secret should fail verification
      expect(
        dispatcher.verifySignature(payload, secret + 'wrong', signature),
      ).toBe(false)

      // Wrong payload should fail verification
      expect(
        dispatcher.verifySignature(payload + 'tampered', secret, signature),
      ).toBe(false)

      // Wrong signature should fail verification
      expect(
        dispatcher.verifySignature(payload, secret, signature + '00'),
      ).toBe(false)
    },
  )

  test.prop([
    fc.string({ minLength: 1, maxLength: 500 }),
    fc.string({ minLength: 10, maxLength: 50 }),
  ])(
    'Property 59: X-KASO-Signature header is included when secret is set',
    (payload, secret) => {
      const dispatcher = createWebhookDispatcher()
      const webhook = createMockWebhookConfig({ secret })

      const headers = dispatcher.buildHeaders(webhook, payload)

      // Should include signature header
      expect(headers['X-KASO-Signature']).toBeDefined()
      expect(headers['X-KASO-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/)
    },
  )

  test.prop([fc.string({ minLength: 1, maxLength: 500 })])(
    'Property 59: No signature header when secret is not set',
    (payload) => {
      const dispatcher = createWebhookDispatcher()
      const webhook = createMockWebhookConfig() // No secret

      const headers = dispatcher.buildHeaders(webhook, payload)

      // Should not include signature header
      expect(headers['X-KASO-Signature']).toBeUndefined()
    },
  )
})

// =============================================================================
// Additional Integration Tests
// =============================================================================

describe('WebhookDispatcher Integration', () => {
  it('should dispatch to matching webhooks only', async () => {
    const deliveries: string[] = []

    const mockFetch = async (url: string): Promise<Response> => {
      deliveries.push(url)
      return new Response('OK', { status: 200 })
    }

    const dispatcher = createWebhookDispatcher(
      {
        webhooks: [
          {
            url: 'https://example.com/webhook1',
            events: ['run:completed'],
            headers: {},
          },
          {
            url: 'https://example.com/webhook2',
            events: ['run:failed'],
            headers: {},
          },
          {
            url: 'https://example.com/webhook3',
            events: [], // All events
            headers: {},
          },
        ],
      },
      { fetchFn: mockFetch as unknown as typeof fetch },
    )

    const event = createMockExecutionEvent({ type: 'run:completed' })

    // Manually trigger dispatch
    const payload = dispatcher.buildPayload(event)
    await dispatcher.dispatchToWebhook(
      dispatcher.getWebhooks()[0]!,
      payload,
    )
    await dispatcher.dispatchToWebhook(
      dispatcher.getWebhooks()[2]!,
      payload,
    )

    expect(deliveries).toContain('https://example.com/webhook1')
    expect(deliveries).toContain('https://example.com/webhook3')
    expect(deliveries).not.toContain('https://example.com/webhook2')
  })

  it('should retry failed deliveries', async () => {
    let attemptCount = 0

    const mockFetch = async (): Promise<Response> => {
      attemptCount++
      return new Response('Error', { status: 500 })
    }

    const dispatcher = createWebhookDispatcher(
      {
        webhooks: [],
        maxRetries: 3,
        baseDelayMs: 10, // Fast for testing
      },
      { fetchFn: mockFetch as unknown as typeof fetch },
    )

    const webhook = createMockWebhookConfig()
    const payload = dispatcher.buildPayload(createMockExecutionEvent())

    const result = await dispatcher.dispatchToWebhook(webhook, payload)

    expect(result.success).toBe(false)
    expect(result.attempts).toBe(3)
    expect(attemptCount).toBe(3)
  })

  it('should sanitize sensitive data in payloads', () => {
    const dispatcher = createWebhookDispatcher()

    const event = createMockExecutionEvent({
      data: {
        specName: 'test',
        apiKey: 'secret123',
        password: 'myPassword',
        token: 'bearer-token',
        authHeader: 'Basic abc123',
        normalField: 'normal-value',
      },
    })

    const payload = dispatcher.buildPayload(event)

    expect(payload.data?.apiKey).toBe('[REDACTED]')
    expect(payload.data?.password).toBe('[REDACTED]')
    expect(payload.data?.token).toBe('[REDACTED]')
    expect(payload.data?.authHeader).toBe('[REDACTED]')
    expect(payload.data?.normalField).toBe('normal-value')
    expect(payload.data?.specName).toBe('test')
  })
})
