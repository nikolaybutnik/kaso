/**
 * Property-based tests for SSE Server
 *
 * Properties:
 * - Property 46: SSE events contain required fields (type, runId, timestamp, phase, agent, elapsedTime)
 * - Property 47: SSE server handles concurrent client connections
 * - Property 48: SSE event filtering by runId works correctly
 * - Property 49: SSE heartbeat maintains connection
 * - Property 50: SSE event format consistency
 * - Property 51: SSE event type filtering
 * - Property 52: SSE authentication handling
 *
 * Requirements: 17.1, 17.2
 */

import { describe, it, expect, afterEach } from 'vitest'
import * as fc from 'fast-check'
import {
  SSEServer,
  createSSEServer,
  type SSEMessage,
} from '../../src/streaming/sse-server'
import { EventBus } from '../../src/core/event-bus'
import type { ExecutionEvent, EventType, PhaseName } from '../../src/core/types'
import http from 'http'

// =============================================================================
// Helpers
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

function createEvent(overrides: Partial<ExecutionEvent> = {}): ExecutionEvent {
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

function parseSSEStream(
  raw: string,
): Array<{ id?: string; event?: string; data?: string }> {
  const events: Array<{ id?: string; event?: string; data?: string }> = []
  const blocks = raw.split('\n\n').filter((b) => b.trim().length > 0)
  for (const block of blocks) {
    const entry: { id?: string; event?: string; data?: string } = {}
    const dataLines: string[] = []
    for (const line of block.split('\n')) {
      if (line.startsWith('id: ')) entry.id = line.slice(4)
      else if (line.startsWith('event: ')) entry.event = line.slice(7)
      else if (line.startsWith('data: ')) dataLines.push(line.slice(6))
    }
    if (dataLines.length > 0) entry.data = dataLines.join('\n')
    if (entry.id || entry.event || entry.data) events.push(entry)
  }
  return events
}

function collectSSEEvents(
  port: number,
  path: string,
  opts: {
    headers?: Record<string, string>
    timeoutMs?: number
    minEvents?: number
  } = {},
): Promise<string> {
  const { headers = {}, timeoutMs = 2000, minEvents = 1 } = opts
  return new Promise((resolve, reject) => {
    const req = http.get(
      `http://localhost:${port}${path}`,
      { headers },
      (res) => {
        if (res.statusCode !== 200) {
          let body = ''
          res.on('data', (chunk: Buffer) => {
            body += chunk.toString()
          })
          res.on('end', () =>
            reject(new Error(`HTTP ${res.statusCode}: ${body}`)),
          )
          return
        }
        let buffer = ''
        const timer = setTimeout(() => {
          req.destroy()
          resolve(buffer)
        }, timeoutMs)
        res.on('data', (chunk: Buffer) => {
          buffer += chunk.toString()
          if (parseSSEStream(buffer).length >= minEvents) {
            clearTimeout(timer)
            setTimeout(() => {
              req.destroy()
              resolve(buffer)
            }, 50)
          }
        })
        res.on('end', () => {
          clearTimeout(timer)
          resolve(buffer)
        })
      },
    )
    req.on('error', (err) => {
      if (
        err.message.includes('ECONNRESET') ||
        err.message.includes('socket hang up')
      )
        resolve('')
      else reject(err)
    })
  })
}

// =============================================================================
// Property Tests
// =============================================================================

describe('SSE Property Tests', () => {
  let server: SSEServer | null = null

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
    it('for any event type/phase/agent combo, the SSE message contains type, runId, and timestamp', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...EVENT_TYPES),
          fc.constantFrom(...PHASE_NAMES),
          fc
            .string({ minLength: 1, maxLength: 30 })
            .filter((s) => /^[a-z-]+$/.test(s)),
          fc
            .string({ minLength: 1, maxLength: 30 })
            .filter((s) => /^[a-z-]+$/.test(s)),
          async (eventType, phase, runId, agent) => {
            const eventBus = new EventBus()
            server = createSSEServer(eventBus, { port: 0 })
            await server.start()
            const port = server.getPort()

            const collectPromise = collectSSEEvents(port, '/events', {
              minEvents: 2,
              timeoutMs: 2000,
            })
            await new Promise((resolve) => setTimeout(resolve, 80))

            eventBus.emit(createEvent({ type: eventType, phase, runId, agent }))

            const raw = await collectPromise
            const events = parseSSEStream(raw)
            const sseEvent = events.find((e) => e.event === eventType)

            expect(sseEvent).toBeDefined()
            const data: SSEMessage = JSON.parse(sseEvent!.data!)
            expect(data.type).toBe(eventType)
            expect(data.runId).toBe(runId)
            expect(data.timestamp).toBeDefined()
            expect(data.phase).toBe(phase)
            expect(data.agent).toBe(agent)

            await server.stop()
            server = null
          },
        ),
        { numRuns: 8 },
      )
    })

    it('elapsedTime is present when duration is in event data', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 1000000 }),
          async (duration) => {
            const eventBus = new EventBus()
            server = createSSEServer(eventBus, { port: 0 })
            await server.start()
            const port = server.getPort()

            const collectPromise = collectSSEEvents(port, '/events', {
              minEvents: 2,
              timeoutMs: 2000,
            })
            await new Promise((resolve) => setTimeout(resolve, 80))

            eventBus.emit(createEvent({ data: { duration } }))

            const raw = await collectPromise
            const events = parseSSEStream(raw)
            const sseEvent = events.find((e) => e.event === 'phase:started')
            expect(sseEvent).toBeDefined()

            const data: SSEMessage = JSON.parse(sseEvent!.data!)
            expect(data.elapsedTime).toBe(duration)

            await server.stop()
            server = null
          },
        ),
        { numRuns: 8 },
      )
    })
  })

  // ===========================================================================
  // Property 47: Concurrent client connections
  // ===========================================================================

  describe('Property 47: SSE server handles concurrent client connections', () => {
    it('N concurrent clients all receive the same broadcast event', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 5 }),
          async (clientCount) => {
            const eventBus = new EventBus()
            server = createSSEServer(eventBus, { port: 0 })
            await server.start()
            const port = server.getPort()

            // Connect N clients
            const collectors = Array.from({ length: clientCount }, () =>
              collectSSEEvents(port, '/events', {
                minEvents: 2,
                timeoutMs: 3000,
              }),
            )
            await new Promise((resolve) => setTimeout(resolve, 150))

            expect(server.getClientCount()).toBe(clientCount)

            // Broadcast one event
            const testRunId = `concurrent-${clientCount}`
            eventBus.emit(
              createEvent({ type: 'run:completed', runId: testRunId }),
            )

            const results = await Promise.all(collectors)

            // Every client should have received the event
            for (const raw of results) {
              const events = parseSSEStream(raw)
              const found = events.find((e) => e.event === 'run:completed')
              expect(found).toBeDefined()
              expect(JSON.parse(found!.data!).runId).toBe(testRunId)
            }

            await server.stop()
            server = null
          },
        ),
        { numRuns: 5 },
      )
    })
  })

  // ===========================================================================
  // Property 48: Event filtering by runId
  // ===========================================================================

  describe('Property 48: SSE event filtering by runId', () => {
    it('client with runId filter only receives events for that runId', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc
            .string({ minLength: 1, maxLength: 20 })
            .filter((s) => /^[a-z0-9-]+$/.test(s)),
          fc
            .string({ minLength: 1, maxLength: 20 })
            .filter((s) => /^[a-z0-9-]+$/.test(s)),
          async (targetRunId, otherRunId) => {
            fc.pre(targetRunId !== otherRunId)

            const eventBus = new EventBus()
            server = createSSEServer(eventBus, { port: 0 })
            await server.start()
            const port = server.getPort()

            const collectPromise = collectSSEEvents(
              port,
              `/events?runId=${encodeURIComponent(targetRunId)}`,
              { minEvents: 2, timeoutMs: 2000 },
            )
            await new Promise((resolve) => setTimeout(resolve, 80))

            // Emit for both runIds
            eventBus.emit(
              createEvent({ type: 'phase:started', runId: targetRunId }),
            )
            eventBus.emit(
              createEvent({ type: 'phase:completed', runId: otherRunId }),
            )

            const raw = await collectPromise
            const events = parseSSEStream(raw)
            const nonConnected = events.filter((e) => e.event !== 'connected')

            // Should only have the target event
            expect(nonConnected.length).toBe(1)
            expect(JSON.parse(nonConnected[0]!.data!).runId).toBe(targetRunId)

            await server.stop()
            server = null
          },
        ),
        { numRuns: 8 },
      )
    })
  })

  // ===========================================================================
  // Property 49: Heartbeat maintains connection
  // ===========================================================================

  describe('Property 49: SSE heartbeat maintains connection', () => {
    it('ping events are delivered within the configured interval', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 80, max: 300 }),
          async (intervalMs) => {
            const eventBus = new EventBus()
            server = createSSEServer(eventBus, {
              port: 0,
              heartbeatIntervalMs: intervalMs,
            })
            await server.start()
            const port = server.getPort()

            // Wait long enough for at least one heartbeat
            const raw = await collectSSEEvents(port, '/events', {
              minEvents: 2,
              timeoutMs: intervalMs + 200,
            })
            const events = parseSSEStream(raw)

            const ping = events.find((e) => e.event === 'ping')
            expect(ping).toBeDefined()

            const data = JSON.parse(ping!.data!)
            expect(data.timestamp).toBeDefined()
            expect(typeof data.clients).toBe('number')

            await server.stop()
            server = null
          },
        ),
        { numRuns: 5 },
      )
    })
  })

  // ===========================================================================
  // Property 50: Event format consistency
  // ===========================================================================

  describe('Property 50: SSE event format consistency', () => {
    it('every SSE event has id, event, and parseable JSON data fields', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...EVENT_TYPES),
          fc.constantFrom(...PHASE_NAMES),
          fc.integer({ min: 0, max: 100000 }),
          async (type, phase, duration) => {
            const eventBus = new EventBus()
            server = createSSEServer(eventBus, { port: 0 })
            await server.start()
            const port = server.getPort()

            const collectPromise = collectSSEEvents(port, '/events', {
              minEvents: 2,
              timeoutMs: 2000,
            })
            await new Promise((resolve) => setTimeout(resolve, 80))

            eventBus.emit(createEvent({ type, phase, data: { duration } }))

            const raw = await collectPromise
            const events = parseSSEStream(raw)

            // Every event should have id, event type, and valid JSON data
            for (const evt of events) {
              expect(evt.id).toBeDefined()
              expect(evt.event).toBeDefined()
              expect(evt.data).toBeDefined()
              expect(() => JSON.parse(evt.data!)).not.toThrow()
            }

            await server.stop()
            server = null
          },
        ),
        { numRuns: 8 },
      )
    })

    it('SSEMessage data always contains type and runId', async () => {
      const eventBus = new EventBus()
      server = createSSEServer(eventBus, { port: 0 })
      await server.start()
      const port = server.getPort()

      const collectPromise = collectSSEEvents(port, '/events', {
        minEvents: 4,
        timeoutMs: 3000,
      })
      await new Promise((resolve) => setTimeout(resolve, 80))

      // Emit several different event types
      for (const type of [
        'phase:started',
        'run:completed',
        'agent:progress',
      ] as EventType[]) {
        eventBus.emit(createEvent({ type, runId: 'format-test' }))
      }

      const raw = await collectPromise
      const events = parseSSEStream(raw)
      const nonConnected = events.filter((e) => e.event !== 'connected')

      for (const evt of nonConnected) {
        const data: SSEMessage = JSON.parse(evt.data!)
        expect(data.type).toBeDefined()
        expect(data.runId).toBe('format-test')
        expect(data.timestamp).toBeDefined()
      }
    })
  })

  // ===========================================================================
  // Property 51: Event type filtering
  // ===========================================================================

  describe('Property 51: SSE event type filtering', () => {
    it('client with event filter only receives matching event types', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.subarray(EVENT_TYPES, { minLength: 1, maxLength: 4 }),
          async (allowedTypes) => {
            const eventBus = new EventBus()
            server = createSSEServer(eventBus, { port: 0 })
            await server.start()
            const port = server.getPort()

            const filterParam = allowedTypes.join(',')
            const collectPromise = collectSSEEvents(
              port,
              `/events?events=${filterParam}`,
              { minEvents: 1 + allowedTypes.length, timeoutMs: 2000 },
            )
            await new Promise((resolve) => setTimeout(resolve, 80))

            // Emit ALL event types
            for (const type of EVENT_TYPES) {
              eventBus.emit(createEvent({ type }))
            }

            const raw = await collectPromise
            const events = parseSSEStream(raw)
            const nonConnected = events.filter((e) => e.event !== 'connected')

            // Every received event should be in the allowed list
            for (const evt of nonConnected) {
              expect(allowedTypes).toContain(evt.event)
            }

            // Should have received exactly the allowed types
            expect(nonConnected.length).toBe(allowedTypes.length)

            await server.stop()
            server = null
          },
        ),
        { numRuns: 8 },
      )
    })
  })

  // ===========================================================================
  // Property 52: Authentication handling
  // ===========================================================================

  describe('Property 52: SSE authentication handling', () => {
    it('any token that is not the configured token gets rejected', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc
            .string({ minLength: 1, maxLength: 50 })
            .filter((t) => t !== 'valid-token'),
          async (invalidToken) => {
            const eventBus = new EventBus()
            server = createSSEServer(eventBus, {
              port: 0,
              authToken: 'valid-token',
            })
            await server.start()
            const port = server.getPort()

            const response = await fetch(`http://localhost:${port}/events`, {
              headers: { Authorization: `Bearer ${invalidToken}` },
            })
            expect(response.status).toBe(401)

            await server.stop()
            server = null
          },
        ),
        { numRuns: 5 },
      )
    }, 60000)

    it('the exact configured token is always accepted', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc
            .string({ minLength: 8, maxLength: 50 })
            .filter((s) => /^[a-zA-Z0-9_-]+$/.test(s)),
          async (token) => {
            const eventBus = new EventBus()
            server = createSSEServer(eventBus, { port: 0, authToken: token })
            await server.start()
            const port = server.getPort()

            const response = await fetch(`http://localhost:${port}/events`, {
              headers: { Authorization: `Bearer ${token}` },
            })
            expect(response.status).toBe(200)

            await server.stop()
            server = null
          },
        ),
        { numRuns: 5 },
      )
    }, 60000)

    it('no auth required when authToken is not configured', async () => {
      const eventBus = new EventBus()
      server = createSSEServer(eventBus, { port: 0, authToken: undefined })
      await server.start()
      const port = server.getPort()

      const response = await fetch(`http://localhost:${port}/events`)
      expect(response.status).toBe(200)
    })
  })
})

// =============================================================================
// SSEMessage type contract
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
  })
})
