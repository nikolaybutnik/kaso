/**
 * Unit tests for SSE Server
 *
 * Requirements: 17.1, 17.2
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SSEServer, createSSEServer } from '../../src/streaming/sse-server'
import { EventBus } from '../../src/core/event-bus'
import type { SSEConfig } from '../../src/config/schema'
import type { ExecutionEvent } from '../../src/core/types'
import http from 'http'

// =============================================================================
// Test Helpers
// =============================================================================

function createMockSSEConfig(overrides: Partial<SSEConfig> = {}): SSEConfig {
  return {
    enabled: true,
    port: 0,
    host: 'localhost',
    endpoint: '/events',
    heartbeatIntervalMs: 60000, // Long default so heartbeats don't interfere
    authToken: undefined,
    maxClients: 100,
    ...overrides,
  }
}

function createMockEvent(
  overrides: Partial<ExecutionEvent> = {},
): ExecutionEvent {
  return {
    type: 'phase:started',
    runId: 'test-run-123',
    timestamp: new Date().toISOString(),
    phase: 'intake',
    agent: 'spec-reader',
    data: { duration: 5000, message: 'Phase started' },
    ...overrides,
  }
}

/**
 * Parse raw SSE text into structured events.
 * SSE format: "id: ...\nevent: ...\ndata: ...\n\n"
 */
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

/**
 * Connect to SSE endpoint and collect events until we have enough or timeout.
 * Returns the raw text chunks received.
 */
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
          const events = parseSSEStream(buffer)
          if (events.length >= minEvents) {
            clearTimeout(timer)
            // Give a tiny bit more time for any trailing data
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
      ) {
        resolve('')
      } else {
        reject(err)
      }
    })
  })
}

// =============================================================================
// Test Suite
// =============================================================================

describe('SSEServer', () => {
  let eventBus: EventBus
  let server: SSEServer

  beforeEach(() => {
    eventBus = new EventBus()
  })

  afterEach(async () => {
    if (server && server.isRunning()) {
      await server.stop()
    }
  })

  // ===========================================================================
  // Initialization and Lifecycle
  // ===========================================================================

  describe('initialization', () => {
    it('should create SSE server with default config', () => {
      server = createSSEServer(eventBus)
      expect(server.isRunning()).toBe(false)
      expect(server.getClientCount()).toBe(0)
    })

    it('should throw error when starting already running server', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()
      await expect(server.start()).rejects.toThrow('already running')
    })
  })

  describe('lifecycle', () => {
    it('should start and stop server successfully', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())

      expect(server.isRunning()).toBe(false)
      await server.start()
      expect(server.isRunning()).toBe(true)

      await server.stop()
      expect(server.isRunning()).toBe(false)
    })

    it('should handle multiple start/stop cycles', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())

      for (let i = 0; i < 3; i++) {
        await server.start()
        expect(server.isRunning()).toBe(true)
        await server.stop()
        expect(server.isRunning()).toBe(false)
      }
    })

    it('should safely stop non-running server', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.stop()
      expect(server.isRunning()).toBe(false)
    })

    it('should disconnect all clients on stop', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()
      const port = server.getPort()

      // Connect a client (fire and forget — we just want it registered)
      collectSSEEvents(port, '/events', {
        timeoutMs: 5000,
        minEvents: 999,
      }).catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(server.getClientCount()).toBe(1)

      await server.stop()
      expect(server.getClientCount()).toBe(0)
    })
  })

  // ===========================================================================
  // Client Connection Management
  // ===========================================================================

  describe('client connections', () => {
    it('should accept SSE connections and send initial connected event', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()
      const port = server.getPort()

      const raw = await collectSSEEvents(port, '/events', {
        minEvents: 1,
        timeoutMs: 2000,
      })
      const events = parseSSEStream(raw)

      expect(events.length).toBeGreaterThanOrEqual(1)
      const connected = events.find((e) => e.event === 'connected')
      expect(connected).toBeDefined()

      const data = JSON.parse(connected!.data!)
      expect(data.clientId).toBeDefined()
      expect(data.message).toContain('Connected')
    })

    it('should track client count accurately', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()
      const port = server.getPort()

      expect(server.getClientCount()).toBe(0)

      // Connect two clients
      const p1 = collectSSEEvents(port, '/events', {
        timeoutMs: 3000,
        minEvents: 999,
      }).catch(() => {})
      const p2 = collectSSEEvents(port, '/events', {
        timeoutMs: 3000,
        minEvents: 999,
      }).catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 100))

      expect(server.getClientCount()).toBe(2)
      expect(server.getClientIds().length).toBe(2)

      // Cleanup
      await server.stop()
      await Promise.allSettled([p1, p2])
    })

    it('should enforce maxClients limit', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig({ maxClients: 2 }))
      await server.start()
      const port = server.getPort()

      // Fill up the slots
      const p1 = collectSSEEvents(port, '/events', {
        timeoutMs: 3000,
        minEvents: 999,
      }).catch(() => {})
      const p2 = collectSSEEvents(port, '/events', {
        timeoutMs: 3000,
        minEvents: 999,
      }).catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(server.getClientCount()).toBe(2)

      // Third client should be rejected
      const response = await fetch(`http://localhost:${port}/events`)
      expect(response.status).toBe(503)

      await server.stop()
      await Promise.allSettled([p1, p2])
    })
  })

  // ===========================================================================
  // Event Broadcasting — actual data verification
  // ===========================================================================

  describe('event broadcasting', () => {
    it('should deliver events to connected clients with correct SSE format', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()
      const port = server.getPort()

      // Start collecting (wait for connected + 1 real event)
      const collectPromise = collectSSEEvents(port, '/events', {
        minEvents: 2,
        timeoutMs: 3000,
      })

      // Wait for client to connect
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Emit an event
      eventBus.emit(
        createMockEvent({
          type: 'phase:completed',
          runId: 'run-abc',
          phase: 'validation',
          agent: 'spec-validator',
          data: { duration: 12345 },
        }),
      )

      const raw = await collectPromise
      const events = parseSSEStream(raw)

      // Find the phase:completed event
      const phaseEvent = events.find((e) => e.event === 'phase:completed')
      expect(phaseEvent).toBeDefined()
      expect(phaseEvent!.id).toBeDefined()

      const data = JSON.parse(phaseEvent!.data!)
      expect(data.type).toBe('phase:completed')
      expect(data.runId).toBe('run-abc')
      expect(data.phase).toBe('validation')
      expect(data.agent).toBe('spec-validator')
      expect(data.elapsedTime).toBe(12345)
    })

    it('should include phase, agent, and elapsedTime per Req 17.2', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()
      const port = server.getPort()

      const collectPromise = collectSSEEvents(port, '/events', {
        minEvents: 2,
        timeoutMs: 3000,
      })
      await new Promise((resolve) => setTimeout(resolve, 100))

      eventBus.emit(
        createMockEvent({
          type: 'agent:progress',
          phase: 'implementation',
          agent: 'executor',
          data: { elapsedTime: 42000 },
        }),
      )

      const raw = await collectPromise
      const events = parseSSEStream(raw)
      const progressEvent = events.find((e) => e.event === 'agent:progress')
      expect(progressEvent).toBeDefined()

      const data = JSON.parse(progressEvent!.data!)
      expect(data.phase).toBe('implementation')
      expect(data.agent).toBe('executor')
      expect(data.elapsedTime).toBe(42000)
      expect(data.timestamp).toBeDefined()
    })

    it('should calculate elapsed time from startTime when no duration', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()
      const port = server.getPort()

      const collectPromise = collectSSEEvents(port, '/events', {
        minEvents: 2,
        timeoutMs: 3000,
      })
      await new Promise((resolve) => setTimeout(resolve, 100))

      const now = new Date()
      const fiveSecondsAgo = new Date(now.getTime() - 5000)

      eventBus.emit(
        createMockEvent({
          timestamp: now.toISOString(),
          data: { startTime: fiveSecondsAgo.toISOString() },
        }),
      )

      const raw = await collectPromise
      const events = parseSSEStream(raw)
      const event = events.find((e) => e.event === 'phase:started')
      expect(event).toBeDefined()

      const data = JSON.parse(event!.data!)
      // Should be approximately 5000ms (allow some tolerance)
      expect(data.elapsedTime).toBeGreaterThanOrEqual(4900)
      expect(data.elapsedTime).toBeLessThanOrEqual(5100)
    })

    it('should handle events without data gracefully', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()
      const port = server.getPort()

      const collectPromise = collectSSEEvents(port, '/events', {
        minEvents: 2,
        timeoutMs: 3000,
      })
      await new Promise((resolve) => setTimeout(resolve, 100))

      eventBus.emit(createMockEvent({ data: undefined }))

      const raw = await collectPromise
      const events = parseSSEStream(raw)
      const event = events.find((e) => e.event === 'phase:started')
      expect(event).toBeDefined()

      const data = JSON.parse(event!.data!)
      expect(data.type).toBe('phase:started')
      expect(data.elapsedTime).toBeUndefined()
    })

    it('should broadcast to multiple clients simultaneously', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()
      const port = server.getPort()

      const collect1 = collectSSEEvents(port, '/events', {
        minEvents: 2,
        timeoutMs: 3000,
      })
      const collect2 = collectSSEEvents(port, '/events', {
        minEvents: 2,
        timeoutMs: 3000,
      })
      await new Promise((resolve) => setTimeout(resolve, 100))

      eventBus.emit(
        createMockEvent({ type: 'run:completed', runId: 'broadcast-test' }),
      )

      const [raw1, raw2] = await Promise.all([collect1, collect2])

      const events1 = parseSSEStream(raw1)
      const events2 = parseSSEStream(raw2)

      const completed1 = events1.find((e) => e.event === 'run:completed')
      const completed2 = events2.find((e) => e.event === 'run:completed')

      expect(completed1).toBeDefined()
      expect(completed2).toBeDefined()
      expect(JSON.parse(completed1!.data!).runId).toBe('broadcast-test')
      expect(JSON.parse(completed2!.data!).runId).toBe('broadcast-test')
    })
  })

  // ===========================================================================
  // Event Filtering — verify filtering actually works on data
  // ===========================================================================

  describe('event filtering', () => {
    it('should only deliver events matching runId filter', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()
      const port = server.getPort()

      // Connect with runId filter
      const collectPromise = collectSSEEvents(
        port,
        '/events?runId=target-run',
        {
          minEvents: 2,
          timeoutMs: 3000,
        },
      )
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Emit matching and non-matching events
      eventBus.emit(
        createMockEvent({ type: 'phase:started', runId: 'target-run' }),
      )
      eventBus.emit(
        createMockEvent({ type: 'phase:completed', runId: 'other-run' }),
      )
      eventBus.emit(
        createMockEvent({ type: 'run:completed', runId: 'target-run' }),
      )

      const raw = await collectPromise
      const events = parseSSEStream(raw)

      // Should have connected + 2 matching events (not the other-run one)
      const nonConnectedEvents = events.filter((e) => e.event !== 'connected')
      expect(nonConnectedEvents.length).toBe(2)
      for (const evt of nonConnectedEvents) {
        const data = JSON.parse(evt.data!)
        expect(data.runId).toBe('target-run')
      }
    })

    it('should only deliver events matching event type filter', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()
      const port = server.getPort()

      const collectPromise = collectSSEEvents(
        port,
        '/events?events=phase:started,run:completed',
        {
          minEvents: 2,
          timeoutMs: 3000,
        },
      )
      await new Promise((resolve) => setTimeout(resolve, 100))

      eventBus.emit(createMockEvent({ type: 'phase:started' }))
      eventBus.emit(createMockEvent({ type: 'phase:completed' })) // Should be filtered out
      eventBus.emit(createMockEvent({ type: 'agent:progress' })) // Should be filtered out
      eventBus.emit(createMockEvent({ type: 'run:completed' }))

      const raw = await collectPromise
      const events = parseSSEStream(raw)

      const nonConnectedEvents = events.filter((e) => e.event !== 'connected')
      expect(nonConnectedEvents.length).toBe(2)

      const eventTypes = nonConnectedEvents.map((e) => e.event)
      expect(eventTypes).toContain('phase:started')
      expect(eventTypes).toContain('run:completed')
      expect(eventTypes).not.toContain('phase:completed')
      expect(eventTypes).not.toContain('agent:progress')
    })

    it('should deliver all events when no filter specified', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()
      const port = server.getPort()

      const collectPromise = collectSSEEvents(port, '/events', {
        minEvents: 4,
        timeoutMs: 3000,
      })
      await new Promise((resolve) => setTimeout(resolve, 100))

      eventBus.emit(createMockEvent({ type: 'phase:started' }))
      eventBus.emit(createMockEvent({ type: 'phase:completed' }))
      eventBus.emit(createMockEvent({ type: 'run:completed' }))

      const raw = await collectPromise
      const events = parseSSEStream(raw)

      const nonConnectedEvents = events.filter((e) => e.event !== 'connected')
      expect(nonConnectedEvents.length).toBe(3)
    })
  })

  // ===========================================================================
  // Authentication
  // ===========================================================================

  describe('authentication', () => {
    it('should reject requests without auth token when configured', async () => {
      server = new SSEServer(
        eventBus,
        createMockSSEConfig({ authToken: 'secret-token' }),
      )
      await server.start()
      const port = server.getPort()

      const response = await fetch(`http://localhost:${port}/events`)
      expect(response.status).toBe(401)
    })

    it('should accept requests with valid auth token', async () => {
      server = new SSEServer(
        eventBus,
        createMockSSEConfig({ authToken: 'secret-token' }),
      )
      await server.start()
      const port = server.getPort()

      const response = await fetch(`http://localhost:${port}/events`, {
        headers: { Authorization: 'Bearer secret-token' },
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/event-stream')
    })

    it('should reject requests with invalid auth token', async () => {
      server = new SSEServer(
        eventBus,
        createMockSSEConfig({ authToken: 'secret-token' }),
      )
      await server.start()
      const port = server.getPort()

      const response = await fetch(`http://localhost:${port}/events`, {
        headers: { Authorization: 'Bearer wrong-token' },
      })
      expect(response.status).toBe(401)
    })

    it('should allow access without auth when not configured', async () => {
      server = new SSEServer(
        eventBus,
        createMockSSEConfig({ authToken: undefined }),
      )
      await server.start()
      const port = server.getPort()

      const response = await fetch(`http://localhost:${port}/events`)
      expect(response.status).toBe(200)
    })

    it('should protect all endpoints when auth is configured', async () => {
      server = new SSEServer(
        eventBus,
        createMockSSEConfig({ authToken: 'token' }),
      )
      await server.start()
      const port = server.getPort()

      const healthResponse = await fetch(`http://localhost:${port}/health`)
      expect(healthResponse.status).toBe(401)
    })
  })

  // ===========================================================================
  // Endpoints
  // ===========================================================================

  describe('endpoints', () => {
    it('should respond to health check with client count', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()
      const port = server.getPort()

      // Connect a client first
      const clientPromise = collectSSEEvents(port, '/events', {
        timeoutMs: 3000,
        minEvents: 999,
      }).catch(() => {})
      await new Promise((resolve) => setTimeout(resolve, 100))

      const response = await fetch(`http://localhost:${port}/health`)
      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        status: string
        clients: number
        uptime: number
      }
      expect(body.status).toBe('ok')
      expect(body.clients).toBe(1)
      expect(typeof body.uptime).toBe('number')

      await server.stop()
      await clientPromise
    })

    it('should return 404 for unknown paths', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()
      const port = server.getPort()

      const response = await fetch(`http://localhost:${port}/unknown`)
      expect(response.status).toBe(404)
    })

    it('should return 405 for non-GET methods on SSE endpoint', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()
      const port = server.getPort()

      const response = await fetch(`http://localhost:${port}/events`, {
        method: 'POST',
      })
      expect(response.status).toBe(405)
    })

    it('should support custom endpoint paths', async () => {
      server = new SSEServer(
        eventBus,
        createMockSSEConfig({ endpoint: '/custom-stream' }),
      )
      await server.start()
      const port = server.getPort()

      const response = await fetch(`http://localhost:${port}/custom-stream`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/event-stream')
    })

    it('should set correct SSE headers', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()
      const port = server.getPort()

      const response = await fetch(`http://localhost:${port}/events`)
      expect(response.headers.get('content-type')).toBe('text/event-stream')
      expect(response.headers.get('cache-control')).toBe('no-cache')
      expect(response.headers.get('connection')).toBe('keep-alive')
    })
  })

  // ===========================================================================
  // Heartbeat — verify actual ping data reaches clients
  // ===========================================================================

  describe('heartbeat', () => {
    it('should send ping events to connected clients', async () => {
      server = new SSEServer(
        eventBus,
        createMockSSEConfig({ heartbeatIntervalMs: 100 }),
      )
      await server.start()
      const port = server.getPort()

      // Collect enough events to capture at least one ping
      const raw = await collectSSEEvents(port, '/events', {
        minEvents: 2,
        timeoutMs: 500,
      })
      const events = parseSSEStream(raw)

      const pingEvent = events.find((e) => e.event === 'ping')
      expect(pingEvent).toBeDefined()

      const data = JSON.parse(pingEvent!.data!)
      expect(data.timestamp).toBeDefined()
      expect(typeof data.clients).toBe('number')
    })
  })
})

// =============================================================================
// Factory Function
// =============================================================================

describe('createSSEServer', () => {
  it('should create server with default config', () => {
    const eventBus = new EventBus()
    const server = createSSEServer(eventBus)

    expect(server).toBeInstanceOf(SSEServer)
    expect(server.isRunning()).toBe(false)
  })

  it('should merge custom config with defaults', () => {
    const eventBus = new EventBus()
    const server = createSSEServer(eventBus, { port: 9999, enabled: true })

    expect(server).toBeInstanceOf(SSEServer)
  })
})
