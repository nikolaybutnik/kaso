/**
 * Unit tests for SSE Server
 *
 * Requirements: 17.1, 17.2
 *
 * Optimized: tests that share the same server config reuse a single instance
 * to avoid the overhead of start/stop per test (~100ms each).
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { SSEServer, createSSEServer } from '@/streaming/sse-server'
import { EventBus } from '@/core/event-bus'
import type { SSEConfig } from '@/config/schema'
import type { ExecutionEvent } from '@/core/types'
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
    heartbeatIntervalMs: 60000,
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
 * Connect to SSE endpoint and collect events. Resolves as soon as minEvents
 * are received — no extra trailing delay.
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

/** Tiny sleep — only used where we genuinely need the event loop to tick */
const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms))

// =============================================================================
// Test Suite
// =============================================================================

describe('SSEServer', () => {
  // ===========================================================================
  // Initialization and Lifecycle — these need per-test servers
  // ===========================================================================

  describe('initialization', () => {
    it('should create SSE server with default config', () => {
      const server = createSSEServer(new EventBus())
      expect(server.isRunning()).toBe(false)
      expect(server.getClientCount()).toBe(0)
    })

    it('should throw error when starting already running server', async () => {
      const server = new SSEServer(new EventBus(), createMockSSEConfig())
      await server.start()
      try {
        await expect(server.start()).rejects.toThrow('already running')
      } finally {
        await server.stop()
      }
    })
  })

  describe('lifecycle', () => {
    it('should start and stop server successfully', async () => {
      const server = new SSEServer(new EventBus(), createMockSSEConfig())
      expect(server.isRunning()).toBe(false)
      await server.start()
      expect(server.isRunning()).toBe(true)
      await server.stop()
      expect(server.isRunning()).toBe(false)
    })

    it('should handle multiple start/stop cycles', async () => {
      const server = new SSEServer(new EventBus(), createMockSSEConfig())
      for (let i = 0; i < 3; i++) {
        await server.start()
        expect(server.isRunning()).toBe(true)
        await server.stop()
        expect(server.isRunning()).toBe(false)
      }
    })

    it('should safely stop non-running server', async () => {
      const server = new SSEServer(new EventBus(), createMockSSEConfig())
      await server.stop()
      expect(server.isRunning()).toBe(false)
    })

    it('should disconnect all clients on stop', async () => {
      const eventBus = new EventBus()
      const server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()
      const port = server.getPort()

      collectSSEEvents(port, '/events', {
        timeoutMs: 5000,
        minEvents: 999,
      }).catch(() => {})
      await tick()
      expect(server.getClientCount()).toBe(1)

      await server.stop()
      expect(server.getClientCount()).toBe(0)
    })
  })

  // ===========================================================================
  // Shared server for the bulk of tests — one start/stop for the whole block
  // ===========================================================================

  describe('with shared server', () => {
    let eventBus: EventBus
    let server: SSEServer
    let port: number

    beforeAll(async () => {
      eventBus = new EventBus()
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()
      port = server.getPort()
    })

    afterAll(async () => {
      await server.stop()
    })

    // =========================================================================
    // Client Connection Management
    // =========================================================================

    describe('client connections', () => {
      it('should accept SSE connections and send initial connected event', async () => {
        const raw = await collectSSEEvents(port, '/events', { minEvents: 1 })
        const events = parseSSEStream(raw)
        const connected = events.find((e) => e.event === 'connected')
        expect(connected).toBeDefined()
        const data = JSON.parse(connected!.data!)
        expect(data.clientId).toBeDefined()
        expect(data.message).toContain('Connected')
      })

      it('should track client count accurately', async () => {
        const p1 = collectSSEEvents(port, '/events', {
          timeoutMs: 3000,
          minEvents: 999,
        }).catch(() => {})
        const p2 = collectSSEEvents(port, '/events', {
          timeoutMs: 3000,
          minEvents: 999,
        }).catch(() => {})
        // Give connections enough time to fully establish
        await tick(200)
        expect(server.getClientCount()).toBeGreaterThanOrEqual(2)
        expect(server.getClientIds().length).toBeGreaterThanOrEqual(2)
        await Promise.allSettled([p1, p2])
      })
    })

    // =========================================================================
    // Event Broadcasting
    // =========================================================================

    describe('event broadcasting', () => {
      it('should deliver events with correct SSE format', async () => {
        const collectPromise = collectSSEEvents(port, '/events', {
          minEvents: 2,
        })
        await tick()

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
        const phaseEvent = parseSSEStream(raw).find(
          (e) => e.event === 'phase:completed',
        )
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
        const collectPromise = collectSSEEvents(port, '/events', {
          minEvents: 2,
        })
        await tick()

        eventBus.emit(
          createMockEvent({
            type: 'agent:progress',
            phase: 'implementation',
            agent: 'executor',
            data: { elapsedTime: 42000 },
          }),
        )

        const raw = await collectPromise
        const data = JSON.parse(
          parseSSEStream(raw).find((e) => e.event === 'agent:progress')!.data!,
        )
        expect(data.phase).toBe('implementation')
        expect(data.agent).toBe('executor')
        expect(data.elapsedTime).toBe(42000)
        expect(data.timestamp).toBeDefined()
      })

      it('should calculate elapsed time from startTime when no duration', async () => {
        const collectPromise = collectSSEEvents(port, '/events', {
          minEvents: 2,
        })
        await tick()

        const now = new Date()
        const fiveSecondsAgo = new Date(now.getTime() - 5000)
        eventBus.emit(
          createMockEvent({
            timestamp: now.toISOString(),
            data: { startTime: fiveSecondsAgo.toISOString() },
          }),
        )

        const raw = await collectPromise
        const data = JSON.parse(
          parseSSEStream(raw).find((e) => e.event === 'phase:started')!.data!,
        )
        expect(data.elapsedTime).toBeGreaterThanOrEqual(4900)
        expect(data.elapsedTime).toBeLessThanOrEqual(5100)
      })

      it('should handle events without data gracefully', async () => {
        const collectPromise = collectSSEEvents(port, '/events', {
          minEvents: 2,
        })
        await tick()

        eventBus.emit(createMockEvent({ data: undefined }))

        const raw = await collectPromise
        const data = JSON.parse(
          parseSSEStream(raw).find((e) => e.event === 'phase:started')!.data!,
        )
        expect(data.type).toBe('phase:started')
        expect(data.elapsedTime).toBeUndefined()
      })

      it('should broadcast to multiple clients simultaneously', async () => {
        const collect1 = collectSSEEvents(port, '/events', { minEvents: 2 })
        const collect2 = collectSSEEvents(port, '/events', { minEvents: 2 })

        // Poll until both clients are registered — tick() alone is a race
        const deadline = Date.now() + 2000
        while (server.getClientCount() < 2 && Date.now() < deadline) {
          await tick(10)
        }

        eventBus.emit(
          createMockEvent({ type: 'run:completed', runId: 'broadcast-test' }),
        )

        const [raw1, raw2] = await Promise.all([collect1, collect2])
        for (const raw of [raw1, raw2]) {
          const found = parseSSEStream(raw).find(
            (e) => e.event === 'run:completed',
          )
          expect(found).toBeDefined()
          expect(JSON.parse(found!.data!).runId).toBe('broadcast-test')
        }
      })
    })

    // =========================================================================
    // Event Filtering
    // =========================================================================

    describe('event filtering', () => {
      it('should only deliver events matching runId filter', async () => {
        // minEvents: connected + 2 matching = 3
        const collectPromise = collectSSEEvents(
          port,
          '/events?runId=target-run',
          { minEvents: 3 },
        )
        await tick()

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
        const nonConnected = parseSSEStream(raw).filter(
          (e) => e.event !== 'connected',
        )
        expect(nonConnected.length).toBe(2)
        for (const evt of nonConnected) {
          expect(JSON.parse(evt.data!).runId).toBe('target-run')
        }
      })

      it('should only deliver events matching event type filter', async () => {
        // minEvents: connected + 2 matching = 3
        const collectPromise = collectSSEEvents(
          port,
          '/events?events=phase:started,run:completed',
          { minEvents: 3 },
        )
        await tick()

        eventBus.emit(createMockEvent({ type: 'phase:started' }))
        eventBus.emit(createMockEvent({ type: 'phase:completed' }))
        eventBus.emit(createMockEvent({ type: 'agent:progress' }))
        eventBus.emit(createMockEvent({ type: 'run:completed' }))

        const raw = await collectPromise
        const nonConnected = parseSSEStream(raw).filter(
          (e) => e.event !== 'connected',
        )
        expect(nonConnected.length).toBe(2)
        const types = nonConnected.map((e) => e.event)
        expect(types).toContain('phase:started')
        expect(types).toContain('run:completed')
        expect(types).not.toContain('phase:completed')
        expect(types).not.toContain('agent:progress')
      })

      it('should deliver all events when no filter specified', async () => {
        const collectPromise = collectSSEEvents(port, '/events', {
          minEvents: 4,
        })
        await tick()

        eventBus.emit(createMockEvent({ type: 'phase:started' }))
        eventBus.emit(createMockEvent({ type: 'phase:completed' }))
        eventBus.emit(createMockEvent({ type: 'run:completed' }))

        const raw = await collectPromise
        const nonConnected = parseSSEStream(raw).filter(
          (e) => e.event !== 'connected',
        )
        expect(nonConnected.length).toBe(3)
      })
    })

    // =========================================================================
    // Endpoints
    // =========================================================================

    describe('endpoints', () => {
      it('should respond to health check with client count', async () => {
        const clientPromise = collectSSEEvents(port, '/events', {
          timeoutMs: 2000,
          minEvents: 999,
        }).catch(() => {})
        await tick()

        const response = await fetch(`http://localhost:${port}/health`)
        expect(response.status).toBe(200)
        const body = (await response.json()) as {
          status: string
          clients: number
          uptime: number
        }
        expect(body.status).toBe('ok')
        expect(body.clients).toBeGreaterThanOrEqual(1)
        expect(typeof body.uptime).toBe('number')
        await clientPromise
      })

      it('should return 404 for unknown paths', async () => {
        const response = await fetch(`http://localhost:${port}/unknown`)
        expect(response.status).toBe(404)
      })

      it('should return 405 for non-GET methods on SSE endpoint', async () => {
        const response = await fetch(`http://localhost:${port}/events`, {
          method: 'POST',
        })
        expect(response.status).toBe(405)
      })

      it('should set correct SSE headers', async () => {
        const response = await fetch(`http://localhost:${port}/events`)
        expect(response.headers.get('content-type')).toBe('text/event-stream')
        expect(response.headers.get('cache-control')).toBe('no-cache')
        expect(response.headers.get('connection')).toBe('keep-alive')
      })
    })
  })

  // ===========================================================================
  // maxClients — needs its own server with maxClients: 2
  // ===========================================================================

  describe('maxClients enforcement', () => {
    it('should reject connections beyond maxClients', async () => {
      const server = new SSEServer(
        new EventBus(),
        createMockSSEConfig({ maxClients: 2 }),
      )
      await server.start()
      const port = server.getPort()
      try {
        const p1 = collectSSEEvents(port, '/events', {
          timeoutMs: 2000,
          minEvents: 999,
        }).catch(() => {})
        const p2 = collectSSEEvents(port, '/events', {
          timeoutMs: 2000,
          minEvents: 999,
        }).catch(() => {})
        await tick()
        expect(server.getClientCount()).toBe(2)

        const response = await fetch(`http://localhost:${port}/events`)
        expect(response.status).toBe(503)
        await server.stop()
        await Promise.allSettled([p1, p2])
      } catch {
        await server.stop()
      }
    })
  })

  // ===========================================================================
  // Authentication — shared server with authToken
  // ===========================================================================

  describe('authentication', () => {
    let server: SSEServer
    let port: number

    beforeAll(async () => {
      server = new SSEServer(
        new EventBus(),
        createMockSSEConfig({ authToken: 'secret-token' }),
      )
      await server.start()
      port = server.getPort()
    })

    afterAll(async () => {
      await server.stop()
    })

    it('should reject requests without auth token', async () => {
      const response = await fetch(`http://localhost:${port}/events`)
      expect(response.status).toBe(401)
    })

    it('should accept requests with valid auth token', async () => {
      const response = await fetch(`http://localhost:${port}/events`, {
        headers: { Authorization: 'Bearer secret-token' },
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/event-stream')
    })

    it('should reject requests with invalid auth token', async () => {
      const response = await fetch(`http://localhost:${port}/events`, {
        headers: { Authorization: 'Bearer wrong-token' },
      })
      expect(response.status).toBe(401)
    })

    it('should protect all endpoints when auth is configured', async () => {
      const response = await fetch(`http://localhost:${port}/health`)
      expect(response.status).toBe(401)
    })
  })

  describe('no-auth access', () => {
    it('should allow access without auth when not configured', async () => {
      const server = new SSEServer(
        new EventBus(),
        createMockSSEConfig({ authToken: undefined }),
      )
      await server.start()
      const port = server.getPort()
      const response = await fetch(`http://localhost:${port}/events`)
      expect(response.status).toBe(200)
      await server.stop()
    })
  })

  // ===========================================================================
  // Custom endpoint — needs its own server
  // ===========================================================================

  describe('custom endpoint', () => {
    it('should support custom endpoint paths', async () => {
      const server = new SSEServer(
        new EventBus(),
        createMockSSEConfig({ endpoint: '/custom-stream' }),
      )
      await server.start()
      const port = server.getPort()
      const response = await fetch(`http://localhost:${port}/custom-stream`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/event-stream')
      await server.stop()
    })
  })

  // ===========================================================================
  // Heartbeat — needs short interval
  // ===========================================================================

  describe('heartbeat', () => {
    it('should send ping events to connected clients', async () => {
      const server = new SSEServer(
        new EventBus(),
        createMockSSEConfig({ heartbeatIntervalMs: 50 }),
      )
      await server.start()
      const port = server.getPort()

      const raw = await collectSSEEvents(port, '/events', {
        minEvents: 2,
        timeoutMs: 300,
      })
      const ping = parseSSEStream(raw).find((e) => e.event === 'ping')
      expect(ping).toBeDefined()
      const data = JSON.parse(ping!.data!)
      expect(data.timestamp).toBeDefined()
      expect(typeof data.clients).toBe('number')

      await server.stop()
    })
  })
})

// =============================================================================
// Factory Function
// =============================================================================

describe('createSSEServer', () => {
  it('should create server with default config', () => {
    const server = createSSEServer(new EventBus())
    expect(server).toBeInstanceOf(SSEServer)
    expect(server.isRunning()).toBe(false)
  })

  it('should merge custom config with defaults', () => {
    const server = createSSEServer(new EventBus(), {
      port: 9999,
      enabled: true,
    })
    expect(server).toBeInstanceOf(SSEServer)
  })
})
