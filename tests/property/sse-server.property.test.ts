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
 *
 * Optimization: Properties 46/50 share a single long-lived server since they
 * only vary the event payload, not the server config. Properties 52 (auth)
 * reuse one auth-enabled server for rejection tests and one per-run server
 * only for the "any token accepted" property (which varies the token itself).
 */

import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest'
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
  const { headers = {}, timeoutMs = 1500, minEvents = 1 } = opts
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
            req.destroy()
            resolve(buffer)
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

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms))

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
  // Properties 46 & 50: Shared server — only event payloads vary
  // ===========================================================================

  describe('Properties 46 & 50: event fields and format (shared server)', () => {
    let sharedBus: EventBus
    let sharedServer: SSEServer
    let sharedPort: number

    beforeAll(async () => {
      sharedBus = new EventBus()
      sharedServer = createSSEServer(sharedBus, { port: 0 })
      await sharedServer.start()
      sharedPort = sharedServer.getPort()
    })

    afterAll(async () => {
      await sharedServer.stop()
    })

    it('P46: for any event type/phase/agent combo, SSE message contains required fields', async () => {
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
            const collectPromise = collectSSEEvents(sharedPort, '/events', {
              minEvents: 2,
            })
            await tick()

            sharedBus.emit(
              createEvent({ type: eventType, phase, runId, agent }),
            )

            const raw = await collectPromise
            const sseEvent = parseSSEStream(raw).find(
              (e) => e.event === eventType,
            )
            expect(sseEvent).toBeDefined()

            const data: SSEMessage = JSON.parse(sseEvent!.data!)
            expect(data.type).toBe(eventType)
            expect(data.runId).toBe(runId)
            expect(data.timestamp).toBeDefined()
            expect(data.phase).toBe(phase)
            expect(data.agent).toBe(agent)
          },
        ),
        { numRuns: 8 },
      )
    })

    it('P46: elapsedTime is present when duration is in event data', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 0, max: 1000000 }),
          async (duration) => {
            const collectPromise = collectSSEEvents(sharedPort, '/events', {
              minEvents: 2,
            })
            await tick()

            sharedBus.emit(createEvent({ data: { duration } }))

            const raw = await collectPromise
            const sseEvent = parseSSEStream(raw).find(
              (e) => e.event === 'phase:started',
            )
            expect(sseEvent).toBeDefined()

            const data: SSEMessage = JSON.parse(sseEvent!.data!)
            expect(data.elapsedTime).toBe(duration)
          },
        ),
        { numRuns: 8 },
      )
    })

    it('P50: every SSE event has id, event, and parseable JSON data', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.constantFrom(...EVENT_TYPES),
          fc.constantFrom(...PHASE_NAMES),
          fc.integer({ min: 0, max: 100000 }),
          async (type, phase, duration) => {
            const collectPromise = collectSSEEvents(sharedPort, '/events', {
              minEvents: 2,
            })
            await tick()

            sharedBus.emit(createEvent({ type, phase, data: { duration } }))

            const raw = await collectPromise
            for (const evt of parseSSEStream(raw)) {
              expect(evt.id).toBeDefined()
              expect(evt.event).toBeDefined()
              expect(evt.data).toBeDefined()
              expect(() => JSON.parse(evt.data!)).not.toThrow()
            }
          },
        ),
        { numRuns: 8 },
      )
    })

    it('P50: SSEMessage data always contains type and runId', async () => {
      const collectPromise = collectSSEEvents(sharedPort, '/events', {
        minEvents: 4,
      })
      await tick()

      for (const type of [
        'phase:started',
        'run:completed',
        'agent:progress',
      ] as EventType[]) {
        sharedBus.emit(createEvent({ type, runId: 'format-test' }))
      }

      const raw = await collectPromise
      for (const evt of parseSSEStream(raw).filter(
        (e) => e.event !== 'connected',
      )) {
        const data: SSEMessage = JSON.parse(evt.data!)
        expect(data.type).toBeDefined()
        expect(data.runId).toBe('format-test')
        expect(data.timestamp).toBeDefined()
      }
    })
  })

  // ===========================================================================
  // Property 47: Concurrent clients — needs per-run server (varies client count)
  // ===========================================================================

  describe('Property 47: concurrent client connections', () => {
    it('N concurrent clients all receive the same broadcast event', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 2, max: 5 }),
          async (clientCount) => {
            const eventBus = new EventBus()
            server = createSSEServer(eventBus, { port: 0 })
            await server.start()
            const port = server.getPort()

            const collectors = Array.from({ length: clientCount }, () =>
              collectSSEEvents(port, '/events', {
                minEvents: 2,
                timeoutMs: 2000,
              }),
            )
            await tick(50)

            expect(server.getClientCount()).toBe(clientCount)

            const testRunId = `concurrent-${clientCount}`
            eventBus.emit(
              createEvent({ type: 'run:completed', runId: testRunId }),
            )

            const results = await Promise.all(collectors)
            for (const raw of results) {
              const found = parseSSEStream(raw).find(
                (e) => e.event === 'run:completed',
              )
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
  // Property 48: runId filtering — shared server
  // ===========================================================================

  describe('Property 48: runId filtering (shared server)', () => {
    let sharedBus: EventBus
    let sharedServer: SSEServer
    let sharedPort: number

    beforeAll(async () => {
      sharedBus = new EventBus()
      sharedServer = createSSEServer(sharedBus, { port: 0 })
      await sharedServer.start()
      sharedPort = sharedServer.getPort()
    })

    afterAll(async () => {
      await sharedServer.stop()
    })

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

            const collectPromise = collectSSEEvents(
              sharedPort,
              `/events?runId=${encodeURIComponent(targetRunId)}`,
              { minEvents: 2 },
            )
            await tick()

            sharedBus.emit(
              createEvent({ type: 'phase:started', runId: targetRunId }),
            )
            sharedBus.emit(
              createEvent({ type: 'phase:completed', runId: otherRunId }),
            )

            const raw = await collectPromise
            const nonConnected = parseSSEStream(raw).filter(
              (e) => e.event !== 'connected',
            )
            expect(nonConnected.length).toBe(1)
            expect(JSON.parse(nonConnected[0]!.data!).runId).toBe(targetRunId)
          },
        ),
        { numRuns: 8 },
      )
    })
  })

  // ===========================================================================
  // Property 49: Heartbeat — per-run server (varies interval)
  // ===========================================================================

  describe('Property 49: heartbeat', () => {
    it('ping events are delivered within the configured interval', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.integer({ min: 50, max: 200 }),
          async (intervalMs) => {
            const eventBus = new EventBus()
            server = createSSEServer(eventBus, {
              port: 0,
              heartbeatIntervalMs: intervalMs,
            })
            await server.start()
            const port = server.getPort()

            const raw = await collectSSEEvents(port, '/events', {
              minEvents: 2,
              timeoutMs: intervalMs + 150,
            })
            const ping = parseSSEStream(raw).find((e) => e.event === 'ping')
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
  // Property 51: Event type filtering — shared server
  // ===========================================================================

  describe('Property 51: event type filtering (shared server)', () => {
    let sharedBus: EventBus
    let sharedServer: SSEServer
    let sharedPort: number

    beforeAll(async () => {
      sharedBus = new EventBus()
      sharedServer = createSSEServer(sharedBus, { port: 0 })
      await sharedServer.start()
      sharedPort = sharedServer.getPort()
    })

    afterAll(async () => {
      await sharedServer.stop()
    })

    it('client with event filter only receives matching event types', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.subarray(EVENT_TYPES, { minLength: 1, maxLength: 4 }),
          async (allowedTypes) => {
            const filterParam = allowedTypes.join(',')
            const collectPromise = collectSSEEvents(
              sharedPort,
              `/events?events=${filterParam}`,
              { minEvents: 1 + allowedTypes.length },
            )
            await tick()

            for (const type of EVENT_TYPES) {
              sharedBus.emit(createEvent({ type }))
            }

            const raw = await collectPromise
            const nonConnected = parseSSEStream(raw).filter(
              (e) => e.event !== 'connected',
            )

            for (const evt of nonConnected) {
              expect(allowedTypes).toContain(evt.event)
            }
            expect(nonConnected.length).toBe(allowedTypes.length)
          },
        ),
        { numRuns: 8 },
      )
    })
  })

  // ===========================================================================
  // Property 52: Authentication — shared server for rejection, per-run for acceptance
  // ===========================================================================

  describe('Property 52: authentication', () => {
    let authServer: SSEServer
    let authPort: number

    beforeAll(async () => {
      authServer = createSSEServer(new EventBus(), {
        port: 0,
        authToken: 'valid-token',
      })
      await authServer.start()
      authPort = authServer.getPort()
    })

    afterAll(async () => {
      await authServer.stop()
    })

    it('any token that is not the configured token gets rejected', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc
            .string({ minLength: 1, maxLength: 50 })
            .filter((t) => t !== 'valid-token'),
          async (invalidToken) => {
            const response = await fetch(
              `http://localhost:${authPort}/events`,
              {
                headers: { Authorization: `Bearer ${invalidToken}` },
              },
            )
            expect(response.status).toBe(401)
          },
        ),
        { numRuns: 10 },
      )
    })

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
    }, 30000)

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
