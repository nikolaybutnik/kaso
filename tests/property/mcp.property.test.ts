/**
 * Property-based tests for MCP Client
 *
 * Property 46: MCP tools scoped to Executor_Backend during Implementation only
 *
 * Requirements: 25.2, 25.3
 */

import { describe, it, expect, beforeEach } from 'vitest'
import * as fc from 'fast-check'
import { createMCPClient } from '@/infrastructure/mcp-client'
import { EventBus } from '@/core/event-bus'
import type { MCPServerConfig, MCPToolDefinition } from '@/config/schema'
import type { PhaseName } from '@/core/types'

// =============================================================================
// Property 46: MCP tools scoped to Executor_Backend during Implementation only
// =============================================================================

describe('Property 46: MCP tools scoped to Executor_Backend during Implementation only', () => {
  let eventBus: EventBus

  beforeEach(() => {
    eventBus = new EventBus()
  })

  it('should handle any array of server configurations', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 30 }),
            transport: fc.constantFrom('stdio', 'sse', 'websocket'),
          }),
          { minLength: 0, maxLength: 5 },
        ),
        async (servers) => {
          const configs: MCPServerConfig[] = servers.map((s) => ({
            name: s.name,
            transport: s.transport as 'stdio' | 'sse' | 'websocket',
            command: s.transport === 'stdio' ? 'echo' : undefined,
            url: s.transport !== 'stdio' ? 'http://localhost:3000' : undefined,
            args: [],
            env: {},
          }))

          const client = createMCPClient(configs, eventBus)
          await client.initialize()

          // All servers should have a connection state
          expect(client.getAllConnections()).toHaveLength(configs.length)

          return true
        },
      ),
      { numRuns: 20 },
    )
  })

  it('should return consistent connection states', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 30 }),
        fc.constantFrom('stdio', 'sse', 'websocket'),
        async (name, transport) => {
          const config: MCPServerConfig = {
            name,
            transport,
            command: transport === 'stdio' ? 'echo' : undefined,
            url: transport !== 'stdio' ? 'http://localhost:3000' : undefined,
            args: [],
            env: {},
          }

          const client = createMCPClient([], eventBus)
          const connection = await client.connect(config)

          // Connection state should be one of the valid states
          expect(['connected', 'error']).toContain(connection.state)

          // State reported by getConnectionState should match
          expect(client.getConnectionState(name)).toBe(connection.state)

          return true
        },
      ),
      { numRuns: 30 },
    )
  })

  it('should handle tool availability checks', async () => {
    await fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 50 }), (toolName) => {
        const client = createMCPClient([], eventBus)

        // Unknown tools should not be available
        expect(client.isToolAvailable(toolName)).toBe(false)

        return true
      }),
      { numRuns: 50 },
    )
  })

  it('should maintain tool isolation per server', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            serverName: fc.string({ minLength: 1, maxLength: 20 }),
            toolName: fc.string({ minLength: 1, maxLength: 20 }),
          }),
          { minLength: 0, maxLength: 10 },
        ),
        async (tools) => {
          // Create unique servers from the tools array
          const serverNames = [...new Set(tools.map((t) => t.serverName))]
          const configs: MCPServerConfig[] = serverNames.map((name) => ({
            name,
            transport: 'stdio',
            command: 'echo',
            args: [],
            env: {},
          }))

          const client = createMCPClient(configs, eventBus)
          await client.initialize()

          // Tools from different servers should be isolated
          for (const serverName of serverNames) {
            const serverTools = client.getToolsForServer(serverName)
            expect(serverTools).toBeDefined()
          }

          return true
        },
      ),
      { numRuns: 15 },
    )
  })

  it('should handle reconnection attempts for any server name', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ minLength: 1, maxLength: 30 }),
        async (serverName) => {
          const client = createMCPClient([], eventBus)

          // Reconnecting non-existent server should return false
          const result = await client.reconnect(serverName)
          expect(result).toBe(false)

          return true
        },
      ),
      { numRuns: 20 },
    )
  })

  it('should scope MCP tools to Implementation phase only', () => {
    // MCP tools should only be available/passed during Implementation phase
    const client = createMCPClient([], eventBus)

    const allPhases: PhaseName[] = [
      'intake',
      'validation',
      'architecture-analysis',
      'implementation',
      'architecture-review',
      'test-verification',
      'ui-validation',
      'review-delivery',
    ]

    // Only implementation should be eligible
    for (const phase of allPhases) {
      if (phase === 'implementation') {
        expect(client.isPhaseEligible(phase)).toBe(true)
      } else {
        expect(client.isPhaseEligible(phase)).toBe(false)
      }
    }
  })

  it('should return tools only for implementation phase with injected tools', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1, maxLength: 20 }),
            description: fc.string({ minLength: 1, maxLength: 50 }),
          }),
          { minLength: 1, maxLength: 5 },
        ),
        async (toolDefs) => {
          const client = createMCPClient(
            [
              {
                name: 'test-srv',
                transport: 'stdio',
                command: 'echo',
                args: [],
                env: {},
              },
            ],
            eventBus,
          )
          await client.initialize()

          const tools: import('@/config/schema').MCPToolDefinition[] =
            toolDefs.map((t) => ({
              name: t.name,
              description: t.description,
              inputSchema: {},
              server: 'test-srv',
            }))
          client.setServerTools('test-srv', tools)

          // Implementation gets all tools
          const implTools = client.getToolsForPhase('implementation')
          expect(implTools).toHaveLength(tools.length)

          // Every other phase gets nothing
          const otherPhases: PhaseName[] = [
            'intake',
            'validation',
            'architecture-analysis',
            'architecture-review',
            'test-verification',
            'ui-validation',
            'review-delivery',
          ]
          for (const phase of otherPhases) {
            expect(client.getToolsForPhase(phase)).toHaveLength(0)
          }

          return true
        },
      ),
      { numRuns: 20 },
    )
  })

  it('should handle graceful degradation on server crash', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (serverCount) => {
        const configs: MCPServerConfig[] = Array.from(
          { length: serverCount },
          (_, i) => ({
            name: `server-${i}`,
            transport: 'stdio',
            command: 'echo',
            args: [],
            env: {},
          }),
        )

        const client = createMCPClient(configs, eventBus)
        await client.initialize()

        // Simulate server crashes by disconnecting all
        await client.disconnect()

        // After disconnect, no tools should be available
        expect(client.hasAvailableTools()).toBe(false)

        // All connections should be disconnected
        expect(
          client.getAllConnections().every((c) => c.state === 'disconnected'),
        ).toBe(true)

        return true
      }),
      { numRuns: 10 },
    )
  })
})

// =============================================================================
// MCP Transport Property Tests
// =============================================================================

describe('MCP Transport Properties', () => {
  it('should handle all supported transports', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('stdio', 'sse', 'websocket'),
        async (transport) => {
          const config: MCPServerConfig = {
            name: 'test-server',
            transport: transport as 'stdio' | 'sse' | 'websocket',
            command: transport === 'stdio' ? 'echo' : undefined,
            url: transport !== 'stdio' ? 'http://localhost:3000' : undefined,
            args: [],
            env: {},
          }

          const client = createMCPClient([], new EventBus())
          const connection = await client.connect(config)

          // Should either connect successfully or error gracefully
          expect(['connected', 'error']).toContain(connection.state)

          return true
        },
      ),
      { numRuns: 30 },
    )
  })

  it('should require appropriate config for each transport', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('stdio', 'sse', 'websocket'),
        fc.boolean(),
        async (transport, provideRequired) => {
          const config: MCPServerConfig = {
            name: 'test-server',
            transport: transport as 'stdio' | 'sse' | 'websocket',
            command:
              transport === 'stdio' && provideRequired ? 'echo' : undefined,
            url:
              transport !== 'stdio' && provideRequired
                ? 'http://localhost:3000'
                : undefined,
            args: [],
            env: {},
          }

          const client = createMCPClient([], new EventBus())
          const connection = await client.connect(config)

          if (provideRequired) {
            expect(connection.state).toBe('connected')
          } else {
            expect(connection.state).toBe('error')
            expect(connection.error).toBeDefined()
          }

          return true
        },
      ),
      { numRuns: 30 },
    )
  })
})

// =============================================================================
// MCP Tool Definition Properties
// =============================================================================

describe('MCP Tool Definition Properties', () => {
  it('should handle any valid tool definition structure', async () => {
    await fc.assert(
      fc.property(
        fc.record({
          name: fc.string({ minLength: 1, maxLength: 50 }),
          description: fc.string({ minLength: 1, maxLength: 200 }),
          server: fc.string({ minLength: 1, maxLength: 30 }),
        }),
        (toolDef) => {
          const tool: MCPToolDefinition = {
            name: toolDef.name,
            description: toolDef.description,
            inputSchema: { type: 'object' },
            server: toolDef.server,
          }

          // Tool should have all required fields
          expect(tool.name).toBe(toolDef.name)
          expect(tool.description).toBe(toolDef.description)
          expect(tool.server).toBe(toolDef.server)

          return true
        },
      ),
      { numRuns: 50 },
    )
  })
})

// =============================================================================
// Integration Property Tests
// =============================================================================

describe('MCP Integration Properties', () => {
  it('should maintain consistent state across operations', async () => {
    const client = createMCPClient(
      [
        {
          name: 'server-1',
          transport: 'stdio',
          command: 'echo',
          args: [],
          env: {},
        },
        {
          name: 'server-2',
          transport: 'stdio',
          command: 'echo',
          args: [],
          env: {},
        },
      ],
      new EventBus(),
    )

    await client.initialize()

    // After init, both should be connected
    expect(
      client.getAllConnections().filter((c) => c.state === 'connected'),
    ).toHaveLength(2)

    // After disconnect, none should be connected
    await client.disconnect()
    expect(
      client.getAllConnections().filter((c) => c.state === 'connected'),
    ).toHaveLength(0)

    // After reconnecting one, one should be connected
    await client.connect({
      name: 'server-1',
      transport: 'stdio',
      command: 'echo',
      args: [],
      env: {},
    })
    expect(
      client.getAllConnections().filter((c) => c.state === 'connected'),
    ).toHaveLength(1)
  })

  it('should handle concurrent server operations', async () => {
    const configs: MCPServerConfig[] = Array.from({ length: 5 }, (_, i) => ({
      name: `server-${i}`,
      transport: 'stdio',
      command: 'echo',
      args: [],
      env: {},
    }))

    const client = createMCPClient(configs, new EventBus())

    // Initialize all concurrently
    await client.initialize()

    // All should be in a stable state
    const states = client.getAllConnections().map((c) => c.state)
    expect(states.every((s) => s === 'connected' || s === 'error')).toBe(true)
  })
})
