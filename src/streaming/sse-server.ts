/**
 * SSE Server for real-time streaming of execution events
 *
 * Streams execution events via Server-Sent Events to connected clients.
 * Subscribe to event bus and forward events with current phase, agent identifier,
 * and elapsed time in each event.
 *
 * Requirements: 17.1, 17.2
 */

import { createServer, IncomingMessage, Server, ServerResponse } from 'http'
import { EventBus } from '@/core/event-bus'
import type { ExecutionEvent, PhaseName } from '@/core/types'
import type { SSEConfig } from '@/config/schema'

/**
 * Client connection metadata
 */
interface ClientConnection {
  id: string
  response: ServerResponse<IncomingMessage>
  connectedAt: Date
  lastEventId?: string
  filterRunId?: string
  filterEvents?: string[]
}

/**
 * SSE event payload sent to clients
 */
export interface SSEEventPayload {
  id: string
  event: string
  data: string
}

/**
 * Formatted SSE message for client consumption
 */
export interface SSEMessage {
  type: string
  runId: string
  timestamp: string
  phase?: PhaseName
  agent?: string
  elapsedTime?: number
  data?: Record<string, unknown>
}

/**
 * SSE Server for real-time event streaming
 */
export class SSEServer {
  private server: Server | null = null
  private clients: Map<string, ClientConnection> = new Map()
  private eventUnsubscribe: (() => void) | null = null
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null
  private eventIdCounter = 0

  constructor(
    private eventBus: EventBus,
    private config: SSEConfig,
  ) {}

  /**
   * Start the SSE server
   */
  async start(): Promise<void> {
    if (this.server) {
      throw new Error('SSE server is already running')
    }

    this.server = createServer((req, res) => this.handleRequest(req, res))

    // Subscribe to all events from the event bus
    this.eventUnsubscribe = this.eventBus.onAny((event) => {
      this.broadcastEvent(event)
    })

    // Start heartbeat to keep connections alive
    this.startHeartbeat()

    return new Promise((resolve, reject) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        console.log(
          `SSE server listening on ${this.config.host}:${this.config.port}`,
        )
        resolve()
      })

      this.server!.on('error', (error) => {
        reject(error)
      })
    })
  }

  /**
   * Stop the SSE server
   */
  async stop(): Promise<void> {
    // Stop heartbeat
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }

    // Unsubscribe from event bus
    if (this.eventUnsubscribe) {
      this.eventUnsubscribe()
      this.eventUnsubscribe = null
    }

    // Close all client connections
    for (const client of this.clients.values()) {
      client.response.end()
    }
    this.clients.clear()

    // Close the server
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => {
          this.server = null
          resolve()
        })
      })
    }
  }

  /**
   * Check if the server is running
   */
  isRunning(): boolean {
    return this.server !== null
  }

  /**
   * Get the number of connected clients
   */
  getClientCount(): number {
    return this.clients.size
  }

  /**
   * Get list of connected client IDs
   */
  getClientIds(): string[] {
    return Array.from(this.clients.keys())
  }

  /**
   * Get the port the server is listening on (useful for tests with port 0)
   */
  getPort(): number {
    if (!this.server) return 0
    const address = this.server.address()
    return address && typeof address === 'object' ? address.port : 0
  }

  /**
   * Handle incoming HTTP requests
   */
  private handleRequest(
    req: IncomingMessage,
    res: ServerResponse<IncomingMessage>,
  ): void {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)

    // Check authentication if configured
    if (this.config.authToken && !this.isAuthenticated(req)) {
      res.writeHead(401, { 'Content-Type': 'text/plain' })
      res.end('Unauthorized')
      return
    }

    // SSE endpoint
    if (url.pathname === this.config.endpoint || url.pathname === '/events') {
      if (req.method === 'GET') {
        this.handleSSEConnection(req, res, url)
      } else {
        res.writeHead(405, { 'Content-Type': 'text/plain' })
        res.end('Method Not Allowed')
      }
      return
    }

    // Health check endpoint
    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          status: 'ok',
          clients: this.clients.size,
          uptime: process.uptime(),
        }),
      )
      return
    }

    // 404 for unknown paths
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end('Not Found')
  }

  /**
   * Check if request is authenticated
   */
  private isAuthenticated(req: IncomingMessage): boolean {
    const authHeader = req.headers.authorization
    if (!authHeader) return false

    const token = authHeader.replace('Bearer ', '')
    return token === this.config.authToken
  }

  /**
   * Handle SSE connection setup
   */
  private handleSSEConnection(
    req: IncomingMessage,
    res: ServerResponse<IncomingMessage>,
    url: URL,
  ): void {
    const clientId = this.generateClientId()

    // Enforce maxClients limit before writing SSE headers
    if (this.clients.size >= this.config.maxClients) {
      res.writeHead(503, { 'Content-Type': 'text/plain' })
      res.end('Service Unavailable: max clients reached')
      return
    }

    // Parse query parameters for filtering
    const filterRunId = url.searchParams.get('runId') || undefined
    const filterEvents = url.searchParams.get('events')?.split(',')

    // Get Last-Event-ID header for replay
    const lastEventId = req.headers['last-event-id'] as string | undefined

    // Set SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    })

    // Store client connection
    const client: ClientConnection = {
      id: clientId,
      response: res,
      connectedAt: new Date(),
      lastEventId,
      filterRunId,
      filterEvents,
    }
    this.clients.set(clientId, client)

    // Send initial connection event
    this.sendToClient(clientId, {
      id: this.generateEventId(),
      event: 'connected',
      data: JSON.stringify({
        clientId,
        timestamp: new Date().toISOString(),
        message: 'Connected to KASO SSE stream',
      }),
    })

    // Send replay events if Last-Event-ID is provided
    if (lastEventId) {
      this.sendReplayEvents(clientId, lastEventId)
    }

    // Handle client disconnect
    req.on('close', () => {
      this.clients.delete(clientId)
    })

    req.on('error', () => {
      this.clients.delete(clientId)
    })
  }

  /**
   * Broadcast an event to all connected clients
   */
  private broadcastEvent(event: ExecutionEvent): void {
    const eventId = this.generateEventId()
    const payload: SSEEventPayload = {
      id: eventId,
      event: event.type,
      data: JSON.stringify(this.formatEvent(event)),
    }

    for (const [clientId, client] of this.clients) {
      // Filter by runId if specified
      if (client.filterRunId && client.filterRunId !== event.runId) {
        continue
      }

      // Filter by event type if specified
      if (client.filterEvents && !client.filterEvents.includes(event.type)) {
        continue
      }

      this.sendToClient(clientId, payload)
    }
  }

  /**
   * Send event to a specific client
   */
  private sendToClient(clientId: string, payload: SSEEventPayload): void {
    const client = this.clients.get(clientId)
    if (!client) return

    try {
      const lines: string[] = []

      if (payload.id) {
        lines.push(`id: ${payload.id}`)
      }

      if (payload.event) {
        lines.push(`event: ${payload.event}`)
      }

      // Split data into multiple lines if it contains newlines
      const dataLines = payload.data.split('\n')
      for (const line of dataLines) {
        lines.push(`data: ${line}`)
      }

      lines.push('') // Empty line to terminate the event
      lines.push('') // Extra empty line for SSE spec compliance

      client.response.write(lines.join('\n'))
    } catch {
      // Client disconnected, remove from list
      this.clients.delete(clientId)
    }
  }

  /**
   * Send heartbeat/ping to all clients to keep connections alive
   */
  private sendHeartbeat(): void {
    const payload: SSEEventPayload = {
      id: this.generateEventId(),
      event: 'ping',
      data: JSON.stringify({
        timestamp: new Date().toISOString(),
        clients: this.clients.size,
      }),
    }

    for (const clientId of this.clients.keys()) {
      this.sendToClient(clientId, payload)
    }
  }

  /**
   * Start the heartbeat interval
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
    }

    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat()
    }, this.config.heartbeatIntervalMs)
  }

  /**
   * Send replay events for reconnection with Last-Event-ID
   */
  private sendReplayEvents(clientId: string, lastEventId: string): void {
    // Get recent events from event bus history
    const recentEvents = this.eventBus.getRecentEvents(100)

    // Find the index of the last event ID
    const lastIndex = recentEvents.findIndex(
      (e) => this.generateEventIdForEvent(e) === lastEventId,
    )

    // Send events after the last seen event
    const eventsToReplay =
      lastIndex >= 0 ? recentEvents.slice(lastIndex + 1) : recentEvents

    for (const event of eventsToReplay) {
      const client = this.clients.get(clientId)
      if (!client) break

      // Apply filters
      if (client.filterRunId && client.filterRunId !== event.runId) {
        continue
      }

      if (client.filterEvents && !client.filterEvents.includes(event.type)) {
        continue
      }

      const payload: SSEEventPayload = {
        id: this.generateEventIdForEvent(event),
        event: event.type,
        data: JSON.stringify(this.formatEvent(event)),
      }

      this.sendToClient(clientId, payload)
    }
  }

  /**
   * Format an execution event for SSE transmission
   */
  private formatEvent(event: ExecutionEvent): SSEMessage {
    // Calculate elapsed time from event data or use provided value
    const elapsedTime = this.extractElapsedTime(event)

    return {
      type: event.type,
      runId: event.runId,
      timestamp: event.timestamp,
      phase: event.phase,
      agent: event.agent,
      elapsedTime,
      data: event.data,
    }
  }

  /**
   * Extract elapsed time from event data
   */
  private extractElapsedTime(event: ExecutionEvent): number | undefined {
    if (!event.data) return undefined

    // Check for duration in various forms
    if (typeof event.data.duration === 'number') {
      return event.data.duration
    }

    if (typeof event.data.elapsedTime === 'number') {
      return event.data.elapsedTime
    }

    // Calculate from timestamps if available
    if (event.data.startTime && event.timestamp) {
      const start = new Date(event.data.startTime as string).getTime()
      const end = new Date(event.timestamp).getTime()
      if (!isNaN(start) && !isNaN(end)) {
        return end - start
      }
    }

    return undefined
  }

  /**
   * Generate a unique client ID
   */
  private generateClientId(): string {
    return `client-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`
  }

  /**
   * Generate a unique event ID
   */
  private generateEventId(): string {
    return `event-${++this.eventIdCounter}-${Date.now()}`
  }

  /**
   * Generate event ID for an existing event (for replay)
   */
  private generateEventIdForEvent(event: ExecutionEvent): string {
    // Create a deterministic ID based on event properties
    const hash = `${event.type}-${event.runId}-${event.timestamp}`
    return `event-${hash}`
  }
}

/**
 * Factory function to create an SSE server
 */
export function createSSEServer(
  eventBus: EventBus,
  config?: Partial<SSEConfig>,
): SSEServer {
  const defaultConfig: SSEConfig = {
    enabled: false,
    port: 3001,
    host: 'localhost',
    endpoint: '/events',
    heartbeatIntervalMs: 30000,
    authToken: undefined,
    maxClients: 100,
  }

  return new SSEServer(eventBus, { ...defaultConfig, ...config })
}
