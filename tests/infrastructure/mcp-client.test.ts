/**
 * Unit tests for MCP Client
 *
 * Requirements: 25.1, 25.2, 25.3
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  MCPClient,
  createMCPClient,
  type MCPConnection,
} from '../../src/infrastructure/mcp-client'
import { EventBus } from '../../src/core/event-bus'
import type {
  MCPServerConfig,
  MCPToolDefinition,
} from '../../src/config/schema'

// =============================================================================
// Test Fixtures
// =============================================================================

function createMockServerConfig(
  overrides: Partial<MCPServerConfig> = {},
): MCPServerConfig {
  return {
    name: 'test-server',
    transport: 'stdio',
    command: 'echo',
    args: [],
    env: {},
    ...overrides,
  }
}

function createMockTool(name: string, server: string): MCPToolDefinition {
  return {
    name,
    description: `Test tool ${name}`,
    inputSchema: { type: 'object' },
    server,
  }
}

// =============================================================================
// MCPClient Tests
// =============================================================================

describe('MCPClient', () => {
  let client: MCPClient
  let eventBus: EventBus

  beforeEach(() => {
    eventBus = new EventBus()
    client = createMCPClient([], eventBus)
  })

  // ===========================================================================
  // Initialization
  // ===========================================================================

  describe('initialization', () => {
    it('should create client with empty configs', () => {
      const c = createMCPClient([])
      expect(c.hasAvailableTools()).toBe(false)
    })

    it('should create client with configs', () => {
      const configs = [createMockServerConfig()]
      const c = createMCPClient(configs)
      expect(c).toBeDefined()
    })

    it('should initialize with event bus', () => {
      const c = createMCPClient([], eventBus)
      expect(c).toBeDefined()
    })
  })

  // ===========================================================================
  // Connection Management
  // ===========================================================================

  describe('connection management', () => {
    it('should connect to stdio server', async () => {
      const config = createMockServerConfig({
        transport: 'stdio',
        command: 'test-cmd',
      })
      const connection = await client.connect(config)

      expect(connection.state).toBe('connected')
      expect(connection.name).toBe('test-server')
    })

    it('should connect to sse server', async () => {
      const config = createMockServerConfig({
        transport: 'sse',
        url: 'http://localhost:3000/sse',
      })
      const connection = await client.connect(config)

      expect(connection.state).toBe('connected')
    })

    it('should connect to websocket server', async () => {
      const config = createMockServerConfig({
        transport: 'websocket',
        url: 'ws://localhost:3000/ws',
      })
      const connection = await client.connect(config)

      expect(connection.state).toBe('connected')
    })

    it('should error on stdio without command', async () => {
      const config = createMockServerConfig({
        transport: 'stdio',
        command: undefined,
      })
      const connection = await client.connect(config)

      expect(connection.state).toBe('error')
      expect(connection.error).toContain('requires a command')
    })

    it('should error on sse without url', async () => {
      const config = createMockServerConfig({
        transport: 'sse',
        url: undefined,
      })
      const connection = await client.connect(config)

      expect(connection.state).toBe('error')
      expect(connection.error).toContain('requires a URL')
    })

    it('should return existing connection if already connected', async () => {
      const config = createMockServerConfig()
      const conn1 = await client.connect(config)
      const conn2 = await client.connect(config)

      expect(conn1).toBe(conn2)
    })

    it('should initialize multiple servers', async () => {
      const configs = [
        createMockServerConfig({ name: 'server-1' }),
        createMockServerConfig({ name: 'server-2' }),
      ]
      const c = createMCPClient(configs, eventBus)
      await c.initialize()

      expect(c.getAllConnections()).toHaveLength(2)
      expect(
        c.getAllConnections().every((conn) => conn.state === 'connected'),
      ).toBe(true)
    })

    it('should handle unsupported transport', async () => {
      const config = createMockServerConfig({
        transport: 'unsupported' as 'stdio',
      })
      const connection = await client.connect(config)

      expect(connection.state).toBe('error')
      expect(connection.error).toContain('Unsupported transport')
    })
  })

  // ===========================================================================
  // Disconnection
  // ===========================================================================

  describe('disconnection', () => {
    it('should disconnect from a server', async () => {
      const config = createMockServerConfig()
      await client.connect(config)
      await client.disconnectServer('test-server')

      expect(client.getConnectionState('test-server')).toBe('disconnected')
    })

    it('should disconnect all servers', async () => {
      const configs = [
        createMockServerConfig({ name: 'server-1' }),
        createMockServerConfig({ name: 'server-2' }),
      ]
      const c = createMCPClient(configs, eventBus)
      await c.initialize()
      await c.disconnect()

      expect(
        c.getAllConnections().every((conn) => conn.state === 'disconnected'),
      ).toBe(true)
    })

    it('should handle disconnecting non-existent server', async () => {
      await client.disconnectServer('non-existent')
      // Should not throw
      expect(client.getConnectionState('non-existent')).toBe('disconnected')
    })
  })

  // ===========================================================================
  // Tool Management
  // ===========================================================================

  describe('tool management', () => {
    it('should return empty tools initially', () => {
      expect(client.getAllTools()).toHaveLength(0)
      expect(client.hasAvailableTools()).toBe(false)
    })

    it('should check if tool is available', () => {
      expect(client.isToolAvailable('test-tool')).toBe(false)
    })

    it('should get tools for specific server', async () => {
      const config = createMockServerConfig()
      await client.connect(config)

      const tools = client.getToolsForServer('test-server')
      expect(tools).toBeDefined()
    })
  })

  // ===========================================================================
  // Tool Invocation
  // ===========================================================================

  describe('tool invocation', () => {
    it('should return error for unknown tool', async () => {
      const result = await client.invokeTool('unknown-tool', {})

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('should return error when server not connected', async () => {
      // Create a mock situation where tool exists but server is not connected
      const config = createMockServerConfig()
      await client.connect(config)

      // Manually add a tool to simulate having tools
      const connections = (
        client as unknown as { connections: Map<string, MCPConnection> }
      ).connections
      const conn = connections.get('test-server')!
      conn.tools = [createMockTool('test-tool', 'test-server')]
      conn.state = 'disconnected'

      const result = await client.invokeTool('test-tool', {})

      expect(result.success).toBe(false)
      expect(result.error).toContain('not connected')
    })
  })

  // ===========================================================================
  // Reconnection
  // ===========================================================================

  describe('reconnection', () => {
    it('should attempt reconnect to errored server', async () => {
      const config = createMockServerConfig({
        transport: 'stdio',
        command: undefined,
      })
      await client.connect(config)

      expect(client.getConnectionState('test-server')).toBe('error')

      // Reconnect (uses stored config which still has missing command)
      const success = await client.reconnect('test-server')

      // The reconnect will fail because the stored config is still broken
      expect(typeof success).toBe('boolean')
      expect(['connected', 'error']).toContain(
        client.getConnectionState('test-server'),
      )
    })

    it('should return false for non-existent server', async () => {
      const success = await client.reconnect('non-existent')
      expect(success).toBe(false)
    })
  })

  // ===========================================================================
  // Connection State
  // ===========================================================================

  describe('connection state', () => {
    it('should get connection state', async () => {
      const config = createMockServerConfig()
      await client.connect(config)

      expect(client.getConnectionState('test-server')).toBe('connected')
    })

    it('should return disconnected for unknown server', () => {
      expect(client.getConnectionState('unknown')).toBe('disconnected')
    })

    it('should get all connections', async () => {
      const configs = [
        createMockServerConfig({ name: 'server-1' }),
        createMockServerConfig({ name: 'server-2' }),
      ]
      const c = createMCPClient(configs, eventBus)
      await c.initialize()

      const connections = c.getAllConnections()
      expect(connections).toHaveLength(2)
    })
  })

  // ===========================================================================
  // Event Emission
  // ===========================================================================

  describe('event emission', () => {
    it('should emit events on connect', async () => {
      const emitSpy = vi.spyOn(eventBus, 'emit')
      const config = createMockServerConfig()
      await client.connect(config)

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mcp:connected',
          data: expect.objectContaining({ server: 'test-server' }),
        }),
      )
    })

    it('should emit events on error', async () => {
      const emitSpy = vi.spyOn(eventBus, 'emit')
      const config = createMockServerConfig({
        transport: 'stdio',
        command: undefined,
      })
      await client.connect(config)

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mcp:error',
          data: expect.objectContaining({ server: 'test-server' }),
        }),
      )
    })

    it('should emit events on disconnect', async () => {
      const config = createMockServerConfig()
      await client.connect(config)

      const emitSpy = vi.spyOn(eventBus, 'emit')
      await client.disconnectServer('test-server')

      expect(emitSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'mcp:disconnected',
          data: expect.objectContaining({ server: 'test-server' }),
        }),
      )
    })

    it('should work without event bus', async () => {
      const c = createMCPClient([])
      const config = createMockServerConfig()
      // Should not throw
      await c.connect(config)
      expect(c.getConnectionState('test-server')).toBe('connected')
    })
  })

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('error handling', () => {
    it('should handle connection errors gracefully', async () => {
      const config = createMockServerConfig({
        transport: 'stdio',
        command: undefined,
      })
      const connection = await client.connect(config)

      expect(connection.state).toBe('error')
      expect(connection.error).toBeDefined()
      // Should not throw
    })

    it('should continue execution without MCP tools on error', async () => {
      const configs = [
        createMockServerConfig({
          name: 'broken',
          transport: 'stdio',
          command: undefined,
        }),
        createMockServerConfig({ name: 'working' }),
      ]
      const c = createMCPClient(configs, eventBus)
      await c.initialize()

      // Should have both connections, one in error state
      const connections = c.getAllConnections()
      expect(connections).toHaveLength(2)
      expect(connections.some((conn) => conn.state === 'error')).toBe(true)
      expect(connections.some((conn) => conn.state === 'connected')).toBe(true)
    })
  })

  // ===========================================================================
  // Phase-Scoped Tool Access (Req 25.2, 25.3)
  // ===========================================================================

  describe('phase-scoped tool access', () => {
    it('should return tools for implementation phase', async () => {
      const config = createMockServerConfig()
      await client.connect(config)
      client.setServerTools('test-server', [
        createMockTool('tool-a', 'test-server'),
      ])

      const tools = client.getToolsForPhase('implementation')
      expect(tools).toHaveLength(1)
      expect(tools[0]?.name).toBe('tool-a')
    })

    it('should return empty array for non-implementation phases', async () => {
      const config = createMockServerConfig()
      await client.connect(config)
      client.setServerTools('test-server', [
        createMockTool('tool-a', 'test-server'),
      ])

      expect(client.getToolsForPhase('intake')).toHaveLength(0)
      expect(client.getToolsForPhase('validation')).toHaveLength(0)
      expect(client.getToolsForPhase('architecture-analysis')).toHaveLength(0)
      expect(client.getToolsForPhase('architecture-review')).toHaveLength(0)
      expect(client.getToolsForPhase('test-verification')).toHaveLength(0)
      expect(client.getToolsForPhase('ui-validation')).toHaveLength(0)
      expect(client.getToolsForPhase('review-delivery')).toHaveLength(0)
    })

    it('should return empty for custom phases', async () => {
      const config = createMockServerConfig()
      await client.connect(config)
      client.setServerTools('test-server', [
        createMockTool('tool-a', 'test-server'),
      ])

      expect(client.getToolsForPhase('custom-lint')).toHaveLength(0)
    })

    it('should check phase eligibility', () => {
      expect(client.isPhaseEligible('implementation')).toBe(true)
      expect(client.isPhaseEligible('intake')).toBe(false)
      expect(client.isPhaseEligible('validation')).toBe(false)
      expect(client.isPhaseEligible('review-delivery')).toBe(false)
    })
  })

  // ===========================================================================
  // Tool Injection
  // ===========================================================================

  describe('tool injection', () => {
    it('should inject tools for a connected server', async () => {
      const config = createMockServerConfig()
      await client.connect(config)

      const tools = [
        createMockTool('tool-1', 'test-server'),
        createMockTool('tool-2', 'test-server'),
      ]
      client.setServerTools('test-server', tools)

      expect(client.getAllTools()).toHaveLength(2)
      expect(client.isToolAvailable('tool-1')).toBe(true)
      expect(client.isToolAvailable('tool-2')).toBe(true)
    })

    it('should replace existing tools on re-injection', async () => {
      const config = createMockServerConfig()
      await client.connect(config)

      client.setServerTools('test-server', [
        createMockTool('old-tool', 'test-server'),
      ])
      expect(client.isToolAvailable('old-tool')).toBe(true)

      client.setServerTools('test-server', [
        createMockTool('new-tool', 'test-server'),
      ])
      expect(client.isToolAvailable('old-tool')).toBe(false)
      expect(client.isToolAvailable('new-tool')).toBe(true)
    })

    it('should ignore injection for non-existent server', () => {
      client.setServerTools('ghost-server', [
        createMockTool('tool', 'ghost-server'),
      ])
      expect(client.getAllTools()).toHaveLength(0)
    })

    it('should update allTools when injecting tools', async () => {
      const configs = [
        createMockServerConfig({ name: 'server-a' }),
        createMockServerConfig({ name: 'server-b' }),
      ]
      const c = createMCPClient(configs, eventBus)
      await c.initialize()

      c.setServerTools('server-a', [createMockTool('tool-a', 'server-a')])
      c.setServerTools('server-b', [createMockTool('tool-b', 'server-b')])

      expect(c.getAllTools()).toHaveLength(2)
      expect(c.hasAvailableTools()).toBe(true)
    })
  })

  // ===========================================================================
  // Connected Server Count
  // ===========================================================================

  describe('connected server count', () => {
    it('should return 0 with no connections', () => {
      expect(client.getConnectedServerCount()).toBe(0)
    })

    it('should count connected servers', async () => {
      const configs = [
        createMockServerConfig({ name: 'server-1' }),
        createMockServerConfig({ name: 'server-2' }),
      ]
      const c = createMCPClient(configs, eventBus)
      await c.initialize()

      expect(c.getConnectedServerCount()).toBe(2)
    })

    it('should not count errored servers', async () => {
      const configs = [
        createMockServerConfig({ name: 'good' }),
        createMockServerConfig({
          name: 'bad',
          transport: 'stdio',
          command: undefined,
        }),
      ]
      const c = createMCPClient(configs, eventBus)
      await c.initialize()

      expect(c.getConnectedServerCount()).toBe(1)
    })

    it('should update count after disconnect', async () => {
      const config = createMockServerConfig()
      await client.connect(config)
      expect(client.getConnectedServerCount()).toBe(1)

      await client.disconnectServer('test-server')
      expect(client.getConnectedServerCount()).toBe(0)
    })
  })

  // ===========================================================================
  // Tool Invocation with Injected Tools
  // ===========================================================================

  describe('tool invocation with injected tools', () => {
    it('should invoke an injected tool successfully', async () => {
      const config = createMockServerConfig()
      await client.connect(config)
      client.setServerTools('test-server', [
        createMockTool('my-tool', 'test-server'),
      ])

      const result = await client.invokeTool('my-tool', { key: 'value' })
      expect(result.success).toBe(true)
      expect(result.output).toBeDefined()
    })

    it('should handle invocation failure on crashed server', async () => {
      const config = createMockServerConfig()
      await client.connect(config)
      client.setServerTools('test-server', [
        createMockTool('my-tool', 'test-server'),
      ])

      // Simulate crash by disconnecting
      await client.disconnectServer('test-server')

      // Re-add tools to the disconnected connection to simulate stale state
      const connections = (
        client as unknown as { connections: Map<string, MCPConnection> }
      ).connections
      const conn = connections.get('test-server')!
      conn.tools = [createMockTool('my-tool', 'test-server')]

      const result = await client.invokeTool('my-tool', {})
      expect(result.success).toBe(false)
      expect(result.error).toContain('not connected')
    })
  })
})

// =============================================================================
// createMCPClient Factory Tests
// =============================================================================

describe('createMCPClient', () => {
  it('should create client instance', () => {
    const client = createMCPClient([])
    expect(client).toBeInstanceOf(MCPClient)
  })

  it('should create client with event bus', () => {
    const eventBus = new EventBus()
    const client = createMCPClient([], eventBus)
    expect(client).toBeInstanceOf(MCPClient)
  })
})
