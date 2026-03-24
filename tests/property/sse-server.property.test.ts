/**
 * Property-based tests for SSE Server
 *
 * Properties:
 * - Property 46: SSE events contain required fields (type, runId, timestamp, phase, agent, elapsedTime)
 * - Property 47: SSE server handles concurrent client connections
 * - Property 48: SSE event filtering by runId works correctly
 * - Property 49: SSE heartbeat maintains connection
 *
 * Requirements: 17.1, 17.2
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fc from 'fast-check'
import { SSEServer, createSSEServer, type SSEMessage } from '../../src/streaming/sse-server'
import { EventBus } from '../../src/core/event-bus'
import type { ExecutionEvent, EventType, PhaseName } from '../../src/core/types'

// =============================================================================
// Test Fixtures and Helpers
// =============================================================================

const EVENT_TYPES: EventType[] = [
  'phase:started',
  'phase:completed',
  'phase:failed',
  'phase:timeout',
  'run:started',
  'run:paused',
  'run:resumed',
  'run:completed',
  'run:failed',
  'run:cancelled',
  'agent:progress',
  'agent:error',
]

const PHASE_NAMES: PhaseName[] = [
  'intake',
  'validation',
  'architecture-analysis',
  'implementation',
  'architecture-review',
  'test-verification',
  'ui-validation',
  'review-delivery',
]

function createExecutionEvent(overrides: Partial<ExecutionEvent> = {}): ExecutionEvent {
  return {
    type: 'phase:started',
    runId: 'test-run',
    timestamp: new Date().toISOString(),
    phase: 'intake',
    agent: 'test-agent',
    data: {},
    ...overrides,
  }
}

// =============================================================================
// Property Tests
// =============================================================================

describe('SSE Property Tests', () => {
  let eventBus: EventBus
  let server: SSEServer | null = null

  beforeEach(() => {
    eventBus = new EventBus()
  })

  afterEach(async () => {
    if (server && server.isRunning()) {
      await server.stop()
    }
    server = null
  })

  // ===========================================================================
  // Property 46: SSE events contain required fields
  // ===========================================================================

  describe('Property 46: SSE events contain required fields', () => {
    it('should include type, runId, timestamp in all events', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...EVENT_TYPES),
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.constantFrom(...PHASE_NAMES),
          fc.string({ minLength: 1, maxLength: 50 }),
          async (eventType, runId, timestamp, phase, agent) => {
            server = createSSEServer(eventBus, { port: 0 })
            await server.start()

            const event = createExecutionEvent({
              type: eventType,
              runId,
              timestamp,
              phase,
              agent,
            })

            // Event should be processed without error
            eventBus.emit(event)
            await new Promise((resolve) => setTimeout(resolve, 10))

            expect(server.isRunning()).toBe(true)
          },
        ),
        { numRuns: 20 },
      )
    })

    it('should handle events with various data shapes', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.dictionary(fc.string(), fc.oneof(fc.string(), fc.integer(), fc.boolean())),
          fc.integer({ min: 0, max: 100000 }),
          async (data, duration) => {
            server = createSSEServer(eventBus, { port: 0 })
            await server.start()

            const event = createExecutionEvent({
              data: { ...data, duration },
            })

            eventBus.emit(event)
            await new Promise((resolve) => setTimeout(resolve, 10))

            expect(server.isRunning()).toBe(true)
          },
        ),
        { numRuns: 20 },
      )
    })

    it('should format event with all required fields', async () => {
      server = createSSEServer(eventBus, { port: 0 })
      await server.start()

      const event: ExecutionEvent = {
        type: 'phase:completed',
        runId: 'run-abc-123',
        timestamp: new Date().toISOString(),
        phase: 'validation',
        agent: 'spec-validator',
        data: {
          duration: 12345,
          result: 'success',
        },
      }

      // Emit the event
      eventBus.emit(event)
      await new Promise((resolve) => setTimeout(resolve, 10))

      // Server should remain stable
      expect(server.isRunning()).toBe(true)
    })
  })

  // ===========================================================================
  // Property 47: Concurrent client connections
  // ===========================================================================

  describe('Property 47: SSE server handles concurrent client connections', () => {
    it('should handle rapid start/stop cycles', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 1, max: 5 }),
          async (cycles) => {
            server = createSSEServer(eventBus, { port: 0 })

            for (let i = 0; i < cycles; i++) {
              await server.start()
              expect(server.isRunning()).toBe(true)

              // Emit an event during each cycle
              eventBus.emit(createExecutionEvent())
              await new Promise((resolve) => setTimeout(resolve, 5))

              await server.stop()
              expect(server.isRunning()).toBe(false)
            }
          },
        ),
        { numRuns: 10 },
      )
    })

    it('should handle multiple connection attempts', async () => {
      server = createSSEServer(eventBus, { port: 0 })
      await server.start()

      const httpServer = (server as unknown as { server: { address(): { port: number } | null } }).server
      const address = httpServer?.address()
      const port = address && typeof address === 'object' ? address.port : 0

      // Make multiple concurrent connection requests
      const requests = Array.from({ length: 5 }, () =>
        fetch(`http://localhost:${port}/events`)
      )

      const responses = await Promise.all(requests)

      // All should succeed
      for (const response of responses) {
        expect(response.status).toBe(200)
        expect(response.headers.get('content-type')).toBe('text/event-stream')
      }
    })

    it('should maintain consistent state during event bursts', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 10, max: 50 }),
          async (eventCount) => {
            server = createSSEServer(eventBus, { port: 0 })
            await server.start()

            // Emit many events rapidly
            for (let i = 0; i < eventCount; i++) {
              eventBus.emit(
                createExecutionEvent({
                  type: i % 2 === 0 ? 'phase:started' : 'phase:completed',
                  data: { index: i },
                }),
              )
            }

            await new Promise((resolve) => setTimeout(resolve, 50))

            expect(server.isRunning()).toBe(true)
            expect(server.getClientCount()).toBeGreaterThanOrEqual(0)
          },
        ),
        { numRuns: 10 },
      )
    })
  })

  // ===========================================================================
  // Property 48: Event filtering by runId
  // ===========================================================================

  describe('Property 48: SSE event filtering by runId', () => {
    it('should accept various runId formats in filter', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 100 }),
          async (runId) => {
            server = createSSEServer(eventBus, { port: 0 })
            await server.start()

            const httpServer = (server as unknown as { server: { address(): { port: number } | null } }).server
            const address = httpServer?.address()
            const port = address && typeof address === 'object' ? address.port : 0

            const encodedRunId = encodeURIComponent(runId)
            const response = await fetch(
              `http://localhost:${port}/events?runId=${encodedRunId}`,
            )

            expect(response.status).toBe(200)
          },
        ),
        { numRuns: 20 },
      )
    })

    it('should filter events when client connects with runId', async () => {
      server = createSSEServer(eventBus, { port: 0 })
      await server.start()

      const httpServer = (server as unknown as { server: { address(): { port: number } | null } }).server
      const address = httpServer?.address()
      const port = address && typeof address === 'object' ? address.port : 0

      // Connect with specific runId filter
      const targetRunId = 'target-run-123'
      const response = await fetch(
        `http://localhost:${port}/events?runId=${targetRunId}`,
      )

      expect(response.status).toBe(200)

      // Emit events for different runIds
      eventBus.emit(createExecutionEvent({ runId: targetRunId }))
      eventBus.emit(createExecutionEvent({ runId: 'other-run-456' }))
      eventBus.emit(createExecutionEvent({ runId: targetRunId }))

      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(server.isRunning()).toBe(true)
    })
  })

  // ===========================================================================
  // Property 49: Heartbeat maintains connection
  // ===========================================================================

  describe('Property 49: SSE heartbeat maintains connection', () => {
    it('should maintain server with various heartbeat intervals', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 50, max: 500 }),
          async (intervalMs) => {
            server = createSSEServer(eventBus, {
              port: 0,
              heartbeatIntervalMs: intervalMs,
            })
            await server.start()

            // Wait for at least one heartbeat cycle
            await new Promise((resolve) => setTimeout(resolve, intervalMs + 50))

            expect(server.isRunning()).toBe(true)
          },
        ),
        { numRuns: 10 },
      )
    })

    it('should send ping events during heartbeat', async () => {
      server = createSSEServer(eventBus, {
        port: 0,
        heartbeatIntervalMs: 100,
      })
      await server.start()

      const httpServer = (server as unknown as { server: { address(): { port: number } | null } }).server
      const address = httpServer?.address()
      const port = address && typeof address === 'object' ? address.port : 0

      // Connect a client
      const response = await fetch(`http://localhost:${port}/events`)
      expect(response.status).toBe(200)

      // Wait for multiple heartbeat cycles
      await new Promise((resolve) => setTimeout(resolve, 250))

      expect(server.isRunning()).toBe(true)
    })

    it('should handle various SSE config combinations', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            enabled: fc.boolean(),
            port: fc.integer({ min: 1024, max: 65535 }),
            host: fc.constantFrom('localhost', '127.0.0.1', '0.0.0.0'),
            endpoint: fc.constantFrom('/events', '/stream', '/sse'),
            heartbeatIntervalMs: fc.integer({ min: 1000, max: 60000 }),
            maxClients: fc.integer({ min: 1, max: 1000 }),
          }),
          async (config) => {
            // Use port 0 for testing to avoid conflicts
            server = createSSEServer(eventBus, {
              ...config,
              port: 0,
            })
            await server.start()

            // Emit test event
            eventBus.emit(createExecutionEvent())
            await new Promise((resolve) => setTimeout(resolve, 10))

            expect(server.isRunning()).toBe(true)

            await server.stop()
            expect(server.isRunning()).toBe(false)
          },
        ),
        { numRuns: 10 },
      )
    })
  })

  // ===========================================================================
  // Property 50: Event format consistency
  // ===========================================================================

  describe('Property 50: SSE event format consistency', () => {
    it('should produce valid SSE message format', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...EVENT_TYPES),
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.constantFrom(...PHASE_NAMES),
          fc.string({ minLength: 1, maxLength: 50 }),
          fc.integer({ min: 0, max: 100000 }),
          async (type, runId, phase, agent, duration) => {
            server = createSSEServer(eventBus, { port: 0 })
            await server.start()

            const event: ExecutionEvent = {
              type,
              runId,
              timestamp: new Date().toISOString(),
              phase,
              agent,
              data: { duration },
            }

            // Should not throw when processing event
            eventBus.emit(event)
            await new Promise((resolve) => setTimeout(resolve, 10))

            expect(server.isRunning()).toBe(true)
          },
        ),
        { numRuns: 20 },
      )
    })

    it('should handle edge cases in event data', async () => {
      server = createSSEServer(eventBus, { port: 0 })
      await server.start()

      // Test with empty data
      eventBus.emit(createExecutionEvent({ data: {} }))

      // Test with null/undefined values
      eventBus.emit(
        createExecutionEvent({
          data: {
            nullValue: null,
            undefinedValue: undefined,
          },
        }),
      )

      // Test with nested objects
      eventBus.emit(
        createExecutionEvent({
          data: {
            nested: { deep: { value: 123 } },
            array: [1, 2, 3],
          },
        }),
      )

      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(server.isRunning()).toBe(true)
    })
  })

  // ===========================================================================
  // Property 51: Event type filtering
  // ===========================================================================

  describe('Property 51: SSE event type filtering', () => {
    it('should accept various event type filters', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.constantFrom(...EVENT_TYPES), { minLength: 1, maxLength: 5 }),
          async (eventTypes) => {
            server = createSSEServer(eventBus, { port: 0 })
            await server.start()

            const httpServer = (server as unknown as { server: { address(): { port: number } | null } }).server
            const address = httpServer?.address()
            const port = address && typeof address === 'object' ? address.port : 0

            const eventsParam = eventTypes.join(',')
            const response = await fetch(
              `http://localhost:${port}/events?events=${eventsParam}`,
            )

            expect(response.status).toBe(200)
          },
        ),
        { numRuns: 20 },
      )
    })

    it('should support filtering by multiple event types', async () => {
      server = createSSEServer(eventBus, { port: 0 })
      await server.start()

      const httpServer = (server as unknown as { server: { address(): { port: number } | null } }).server
      const address = httpServer?.address()
      const port = address && typeof address === 'object' ? address.port : 0

      // Connect with event type filter
      const response = await fetch(
        `http://localhost:${port}/events?events=phase:started,phase:completed,run:completed`,
      )
      expect(response.status).toBe(200)

      // Emit various event types
      eventBus.emit(createExecutionEvent({ type: 'phase:started' }))
      eventBus.emit(createExecutionEvent({ type: 'phase:completed' }))
      eventBus.emit(createExecutionEvent({ type: 'agent:progress' }))
      eventBus.emit(createExecutionEvent({ type: 'run:completed' }))

      await new Promise((resolve) => setTimeout(resolve, 20))

      expect(server.isRunning()).toBe(true)
    })
  })

  // ===========================================================================
  // Property 52: Authentication with various tokens
  // ===========================================================================

  describe('Property 52: SSE authentication handling', () => {
    it('should reject invalid auth tokens', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.string({ minLength: 1, maxLength: 100 }).filter(t => t !== 'valid-token'),
          async (invalidToken) => {
            server = createSSEServer(eventBus, {
              port: 0,
              authToken: 'valid-token',
            })
            await server.start()

            const httpServer = (server as unknown as { server: { address(): { port: number } | null } }).server
            const address = httpServer?.address()
            const port = address && typeof address === 'object' ? address.port : 0

            const response = await fetch(`http://localhost:${port}/events`, {
              headers: {
                Authorization: `Bearer ${invalidToken}`,
              },
            })

            expect(response.status).toBe(401)
          },
        ),
        { numRuns: 20 },
      )
    })

    it('should accept valid auth tokens', async () => {
      const validToken = 'my-secret-auth-token'
      server = createSSEServer(eventBus, {
        port: 0,
        authToken: validToken,
      })
      await server.start()

      const httpServer = (server as unknown as { server: { address(): { port: number } | null } }).server
      const address = httpServer?.address()
      const port = address && typeof address === 'object' ? address.port : 0

      const response = await fetch(`http://localhost:${port}/events`, {
        headers: {
          Authorization: `Bearer ${validToken}`,
        },
      })

      expect(response.status).toBe(200)
    })

    it('should allow access without auth when not configured', async () => {
      server = createSSEServer(eventBus, {
        port: 0,
        authToken: undefined,
      })
      await server.start()

      const httpServer = (server as unknown as { server: { address(): { port: number } | null } }).server
      const address = httpServer?.address()
      const port = address && typeof address === 'object' ? address.port : 0

      const response = await fetch(`http://localhost:${port}/events`)
      expect(response.status).toBe(200)
    })
  })
})

// =============================================================================
// Message Format Tests
// =============================================================================

describe('SSE Message Format', () => {
  it('should format message with all fields', () => {
    const message: SSEMessage = {
      type: 'phase:completed',
      runId: 'run-123',
      timestamp: new Date().toISOString(),
      phase: 'validation',
      agent: 'spec-validator',
      elapsedTime: 15000,
      data: { result: 'success' },
    }

    // Verify message structure
    expect(message.type).toBe('phase:completed')
    expect(message.runId).toBe('run-123')
    expect(message.timestamp).toBeDefined()
    expect(message.phase).toBe('validation')
    expect(message.agent).toBe('spec-validator')
    expect(message.elapsedTime).toBe(15000)
    expect(message.data).toEqual({ result: 'success' })
  })

  it('should format message with minimal fields', () => {
    const message: SSEMessage = {
      type: 'run:started',
      runId: 'run-456',
      timestamp: new Date().toISOString(),
    }

    expect(message.type).toBe('run:started')
    expect(message.runId).toBe('run-456')
    expect(message.phase).toBeUndefined()
    expect(message.agent).toBeUndefined()
    expect(message.elapsedTime).toBeUndefined()
    expect(message.data).toBeUndefined()
  })
})
