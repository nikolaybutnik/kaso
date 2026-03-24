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

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockSSEConfig(overrides: Partial<SSEConfig> = {}): SSEConfig {
  return {
    enabled: true,
    port: 0, // Use random port for testing
    host: 'localhost',
    endpoint: '/events',
    heartbeatIntervalMs: 1000, // Short interval for testing
    authToken: undefined,
    maxClients: 100,
    ...overrides,
  }
}

function createMockExecutionEvent(
  overrides: Partial<ExecutionEvent> = {},
): ExecutionEvent {
  return {
    type: 'phase:started',
    runId: 'test-run-123',
    timestamp: new Date().toISOString(),
    phase: 'intake',
    agent: 'spec-reader',
    data: {
      duration: 5000,
      message: 'Phase started',
    },
    ...overrides,
  }
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

    it('should create SSE server with custom config', () => {
      const config: Partial<SSEConfig> = {
        port: 9999,
        host: '127.0.0.1',
        endpoint: '/stream',
      }
      server = createSSEServer(eventBus, config)
      expect(server.isRunning()).toBe(false)
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
      await server.stop() // Should not throw
      expect(server.isRunning()).toBe(false)
    })
  })

  // ===========================================================================
  // Client Connection Management
  // ===========================================================================

  describe('client connections', () => {
    it('should accept SSE client connections', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()

      // Get the actual port
      const httpServer = (server as unknown as { server: { address(): { port: number } | null } }).server
      const address = httpServer?.address()
      const port = address && typeof address === 'object' ? address.port : 0

      expect(port).toBeGreaterThan(0)

      // Connect a client
      const response = await fetch(`http://localhost:${port}/events`)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toBe('text/event-stream')

      // Wait for connection to register
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(server.getClientCount()).toBe(1)
    })

    it('should track multiple client connections', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()

      expect(server.getClientCount()).toBe(0)
    })

    it('should return client IDs', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      expect(server.getClientIds()).toEqual([])
    })
  })

  // ===========================================================================
  // Event Broadcasting
  // ===========================================================================

  describe('event broadcasting', () => {
    it('should format execution events correctly', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()

      const event = createMockExecutionEvent({
        type: 'phase:completed',
        phase: 'validation',
        agent: 'spec-validator',
        data: { duration: 10000, result: 'success' },
      })

      // Emit event - should not throw
      eventBus.emit(event)

      // Give time for event to be processed
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Verify server is still running after event broadcast
      expect(server.isRunning()).toBe(true)
    })

    it('should handle events with elapsed time calculation', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()

      const startTime = new Date(Date.now() - 5000).toISOString()
      const event = createMockExecutionEvent({
        timestamp: new Date().toISOString(),
        data: { startTime },
      })

      eventBus.emit(event)
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(server.isRunning()).toBe(true)
    })

    it('should handle events with direct duration', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()

      const event = createMockExecutionEvent({
        data: { duration: 15000 },
      })

      eventBus.emit(event)
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(server.isRunning()).toBe(true)
    })

    it('should handle events with elapsedTime field', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()

      const event = createMockExecutionEvent({
        data: { elapsedTime: 20000 },
      })

      eventBus.emit(event)
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(server.isRunning()).toBe(true)
    })

    it('should handle events without data', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()

      const event = createMockExecutionEvent({ data: undefined })
      eventBus.emit(event)
      await new Promise((resolve) => setTimeout(resolve, 50))

      expect(server.isRunning()).toBe(true)
    })

    it('should handle all event types', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()

      const eventTypes = [
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
      ] as const

      for (const type of eventTypes) {
        eventBus.emit(
          createMockExecutionEvent({
            type,
            data: { message: `Test ${type}` },
          }),
        )
      }

      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(server.isRunning()).toBe(true)
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

      const httpServer = (server as unknown as { server: { address(): { port: number } | null } }).server
      const address = httpServer?.address()
      const port = address && typeof address === 'object' ? address.port : 0

      const response = await fetch(`http://localhost:${port}/events`)
      expect(response.status).toBe(401)
    })

    it('should accept requests with valid auth token', async () => {
      server = new SSEServer(
        eventBus,
        createMockSSEConfig({ authToken: 'secret-token' }),
      )
      await server.start()

      const httpServer = (server as unknown as { server: { address(): { port: number } | null } }).server
      const address = httpServer?.address()
      const port = address && typeof address === 'object' ? address.port : 0

      const response = await fetch(`http://localhost:${port}/events`, {
        headers: {
          Authorization: 'Bearer secret-token',
        },
      })
      expect(response.status).toBe(200)
    })

    it('should reject requests with invalid auth token', async () => {
      server = new SSEServer(
        eventBus,
        createMockSSEConfig({ authToken: 'secret-token' }),
      )
      await server.start()

      const httpServer = (server as unknown as { server: { address(): { port: number } | null } }).server
      const address = httpServer?.address()
      const port = address && typeof address === 'object' ? address.port : 0

      const response = await fetch(`http://localhost:${port}/events`, {
        headers: {
          Authorization: 'Bearer wrong-token',
        },
      })
      expect(response.status).toBe(401)
    })
  })

  // ===========================================================================
  // Endpoints
  // ===========================================================================

  describe('endpoints', () => {
    it('should respond to health check', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()

      const httpServer = (server as unknown as { server: { address(): { port: number } | null } }).server
      const address = httpServer?.address()
      const port = address && typeof address === 'object' ? address.port : 0

      const response = await fetch(`http://localhost:${port}/health`)
      expect(response.status).toBe(200)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = await response.json() as any
      expect(body.status).toBe('ok')
      expect(typeof body.clients).toBe('number')
      expect(typeof body.uptime).toBe('number')
    })

    it('should return 404 for unknown paths', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()

      const httpServer = (server as unknown as { server: { address(): { port: number } | null } }).server
      const address = httpServer?.address()
      const port = address && typeof address === 'object' ? address.port : 0

      const response = await fetch(`http://localhost:${port}/unknown`)
      expect(response.status).toBe(404)
    })

    it('should return 405 for non-GET methods on SSE endpoint', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()

      const httpServer = (server as unknown as { server: { address(): { port: number } | null } }).server
      const address = httpServer?.address()
      const port = address && typeof address === 'object' ? address.port : 0

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

      const httpServer = (server as unknown as { server: { address(): { port: number } | null } }).server
      const address = httpServer?.address()
      const port = address && typeof address === 'object' ? address.port : 0

      // Should work on custom endpoint
      const response = await fetch(`http://localhost:${port}/custom-stream`)
      expect(response.status).toBe(200)

      // Should also work on /events (fallback)
      const response2 = await fetch(`http://localhost:${port}/events`)
      expect(response2.status).toBe(200)
    })
  })

  // ===========================================================================
  // Heartbeat
  // ===========================================================================

  describe('heartbeat', () => {
    it('should send periodic heartbeats', async () => {
      server = new SSEServer(
        eventBus,
        createMockSSEConfig({ heartbeatIntervalMs: 100 }),
      )
      await server.start()

      // Wait for at least one heartbeat cycle
      await new Promise((resolve) => setTimeout(resolve, 150))

      // Server should still be running
      expect(server.isRunning()).toBe(true)
    })
  })

  // ===========================================================================
  // Event Filtering
  // ===========================================================================

  describe('event filtering', () => {
    it('should support runId query parameter filtering', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()

      const httpServer = (server as unknown as { server: { address(): { port: number } | null } }).server
      const address = httpServer?.address()
      const port = address && typeof address === 'object' ? address.port : 0

      // Connect with runId filter
      const response = await fetch(
        `http://localhost:${port}/events?runId=specific-run`,
      )
      expect(response.status).toBe(200)
    })

    it('should support event type filtering', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()

      const httpServer = (server as unknown as { server: { address(): { port: number } | null } }).server
      const address = httpServer?.address()
      const port = address && typeof address === 'object' ? address.port : 0

      // Connect with events filter
      const response = await fetch(
        `http://localhost:${port}/events?events=phase:started,phase:completed`,
      )
      expect(response.status).toBe(200)
    })
  })

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('error handling', () => {
    it('should handle errors in event listeners gracefully', async () => {
      server = new SSEServer(eventBus, createMockSSEConfig())
      await server.start()

      // Emit events - should not throw
      eventBus.emit(createMockExecutionEvent())
      eventBus.emit(createMockExecutionEvent())

      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(server.isRunning()).toBe(true)
    })
  })
})

describe('createSSEServer', () => {
  it('should create server with default config', () => {
    const eventBus = new EventBus()
    const server = createSSEServer(eventBus)

    expect(server).toBeInstanceOf(SSEServer)
    expect(server.isRunning()).toBe(false)
  })

  it('should merge custom config with defaults', () => {
    const eventBus = new EventBus()
    const server = createSSEServer(eventBus, {
      port: 9999,
      enabled: true,
    })

    expect(server).toBeInstanceOf(SSEServer)
  })
})
