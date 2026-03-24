/**
 * MCP (Model Context Protocol) Client for KASO
 *
 * Connects to configured MCP servers, manages connections, lists available tools,
 * and invokes tools with typed arguments. Makes MCP tool definitions available
 * in AgentContext and passes them to ExecutorBackend during Implementation phase.
 *
 * Handles MCP server crashes gracefully — detects connection loss, logs error,
 * marks tools as unavailable, and continues execution without MCP tools.
 *
 * Requirements: 25.1, 25.2, 25.3
 */

import type { MCPServerConfig, MCPToolDefinition } from '@/config/schema'
import type { EventBus } from '@/core/event-bus'
import type { PhaseName } from '@/core/types'

/** Phases where MCP tools are made available to agents (Req 25.2, 25.3) */
const MCP_ENABLED_PHASES: ReadonlySet<PhaseName> = new Set(['implementation'])

/**
 * MCP connection state
 */
export type MCPConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'

/**
 * MCP server connection info
 */
export interface MCPConnection {
  name: string
  config: MCPServerConfig
  state: MCPConnectionState
  tools: MCPToolDefinition[]
  error?: string
  lastConnected?: Date
}

/**
 * Result of an MCP tool invocation
 */
export interface MCPInvocationResult {
  success: boolean
  output?: unknown
  error?: string
}

/**
 * MCP Client for managing MCP server connections and tool invocation
 */
export class MCPClient {
  private connections = new Map<string, MCPConnection>()
  private allTools: MCPToolDefinition[] = []

  constructor(
    private serverConfigs: MCPServerConfig[],
    private eventBus?: EventBus,
  ) {}

  /**
   * Initialize all MCP server connections
   */
  async initialize(): Promise<void> {
    for (const config of this.serverConfigs) {
      await this.connect(config)
    }
  }

  /**
   * Connect to a single MCP server
   */
  async connect(config: MCPServerConfig): Promise<MCPConnection> {
    const existing = this.connections.get(config.name)
    if (existing && existing.state === 'connected') {
      return existing
    }

    const connection: MCPConnection = {
      name: config.name,
      config,
      state: 'connecting',
      tools: [],
    }

    this.connections.set(config.name, connection)

    try {
      // Simulate connection (actual implementation would use MCP SDK)
      await this.establishConnection(connection)

      connection.state = 'connected'
      connection.lastConnected = new Date()

      // Fetch available tools
      connection.tools = await this.fetchTools(connection)
      this.updateAllTools()

      this.emitEvent('connected', {
        server: config.name,
        tools: connection.tools.length,
      })

      return connection
    } catch (error) {
      connection.state = 'error'
      connection.error = errorMessage(error)

      this.emitEvent('error', { server: config.name, error: connection.error })

      // Continue without this server's tools - graceful degradation
      return connection
    }
  }

  /**
   * Disconnect from all MCP servers
   */
  async disconnect(): Promise<void> {
    for (const [name, connection] of this.connections) {
      if (connection.state === 'connected') {
        await this.disconnectServer(name)
      }
    }
  }

  /**
   * Disconnect from a specific MCP server
   */
  async disconnectServer(name: string): Promise<void> {
    const connection = this.connections.get(name)
    if (!connection) return

    try {
      // Actual implementation would close the connection
      connection.state = 'disconnected'
      connection.tools = []
      this.updateAllTools()

      this.emitEvent('disconnected', { server: name })
    } catch (error) {
      this.emitEvent('error', {
        server: name,
        error: `Disconnect failed: ${errorMessage(error)}`,
      })
    }
  }

  /**
   * Get all available MCP tools from all connected servers
   */
  getAllTools(): MCPToolDefinition[] {
    return [...this.allTools]
  }

  /**
   * Get tools from a specific server
   */
  getToolsForServer(serverName: string): MCPToolDefinition[] {
    const connection = this.connections.get(serverName)
    return connection?.tools ?? []
  }

  /**
   * Get connection state for a server
   */
  getConnectionState(serverName: string): MCPConnectionState {
    return this.connections.get(serverName)?.state ?? 'disconnected'
  }

  /**
   * Get all connection states
   */
  getAllConnections(): MCPConnection[] {
    return Array.from(this.connections.values())
  }

  /**
   * Check if any MCP tools are available
   */
  hasAvailableTools(): boolean {
    return this.allTools.length > 0
  }

  /**
   * Check if a specific tool is available
   */
  isToolAvailable(toolName: string): boolean {
    return this.allTools.some((t) => t.name === toolName)
  }

  /**
   * Get MCP tools scoped to a specific phase.
   * Only the Implementation phase receives MCP tools (Req 25.2, 25.3).
   * All other phases get an empty array.
   */
  getToolsForPhase(phase: PhaseName): MCPToolDefinition[] {
    if (!MCP_ENABLED_PHASES.has(phase)) {
      return []
    }
    return this.getAllTools()
  }

  /**
   * Check if MCP tools should be available for a given phase
   */
  isPhaseEligible(phase: PhaseName): boolean {
    return MCP_ENABLED_PHASES.has(phase)
  }

  /**
   * Inject tools for a specific server connection.
   * Used for testing and for real MCP SDK integration where tools are
   * discovered after connection.
   */
  setServerTools(serverName: string, tools: MCPToolDefinition[]): void {
    const connection = this.connections.get(serverName)
    if (!connection) return
    connection.tools = [...tools]
    this.updateAllTools()
  }

  /**
   * Get the number of currently connected servers
   */
  getConnectedServerCount(): number {
    let count = 0
    for (const conn of this.connections.values()) {
      if (conn.state === 'connected') count++
    }
    return count
  }

  /**
   * Invoke an MCP tool with typed arguments
   */
  async invokeTool(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<MCPInvocationResult> {
    // Find which server has this tool
    const serverName = this.findServerForTool(toolName)
    if (!serverName) {
      return {
        success: false,
        error: `Tool '${toolName}' not found in any connected MCP server`,
      }
    }

    const connection = this.connections.get(serverName)
    if (!connection || connection.state !== 'connected') {
      return {
        success: false,
        error: `Server '${serverName}' is not connected`,
      }
    }

    try {
      this.emitEvent('tool:invoking', { server: serverName, tool: toolName })

      // Actual implementation would call the MCP tool
      const result = await this.executeToolInvocation(
        connection,
        toolName,
        args,
      )

      this.emitEvent('tool:success', { server: serverName, tool: toolName })

      return { success: true, output: result }
    } catch (error) {
      const errorMsg = errorMessage(error)

      this.emitEvent('tool:error', {
        server: serverName,
        tool: toolName,
        error: errorMsg,
      })

      // Mark server as errored but don't crash
      connection.state = 'error'
      connection.error = errorMsg

      return { success: false, error: errorMsg }
    }
  }

  /**
   * Reconnect to a server that encountered an error
   */
  async reconnect(serverName: string): Promise<boolean> {
    const connection = this.connections.get(serverName)
    if (!connection) return false

    // Reset state and try connecting again
    connection.state = 'connecting'
    connection.error = undefined

    try {
      await this.establishConnection(connection)
      connection.state = 'connected'
      connection.lastConnected = new Date()
      connection.tools = await this.fetchTools(connection)
      this.updateAllTools()

      this.emitEvent('reconnected', { server: serverName })
      return true
    } catch (error) {
      connection.state = 'error'
      connection.error = errorMessage(error)
      return false
    }
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Establish connection to an MCP server
   */
  private async establishConnection(connection: MCPConnection): Promise<void> {
    const { config } = connection

    switch (config.transport) {
      case 'stdio':
        if (!config.command) {
          throw new Error('stdio transport requires a command')
        }
        // Actual implementation would spawn process and connect via stdio
        await this.simulateConnectionDelay()
        break

      case 'sse':
        if (!config.url) {
          throw new Error('sse transport requires a URL')
        }
        // Actual implementation would connect to SSE endpoint
        await this.simulateConnectionDelay()
        break

      case 'websocket':
        if (!config.url) {
          throw new Error('websocket transport requires a URL')
        }
        // Actual implementation would connect via WebSocket
        await this.simulateConnectionDelay()
        break

      default:
        throw new Error(`Unsupported transport: ${config.transport}`)
    }
  }

  /**
   * Fetch available tools from a connected server
   */
  private async fetchTools(
    _connection: MCPConnection,
  ): Promise<MCPToolDefinition[]> {
    // Actual implementation would call MCP 'tools/list' method
    // For now, return empty array as this is a stub
    await this.simulateConnectionDelay(50)
    return []
  }

  /**
   * Execute a tool invocation on a server
   */
  private async executeToolInvocation(
    _connection: MCPConnection,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    // Actual implementation would call MCP 'tools/call' method
    await this.simulateConnectionDelay(100)
    return { status: 'success', tool: toolName, args }
  }

  /**
   * Find which server has a specific tool
   */
  private findServerForTool(toolName: string): string | undefined {
    for (const [serverName, connection] of this.connections) {
      if (connection.tools.some((t) => t.name === toolName)) {
        return serverName
      }
    }
    return undefined
  }

  /**
   * Update the combined list of all tools
   */
  private updateAllTools(): void {
    this.allTools = []
    for (const connection of this.connections.values()) {
      if (connection.state === 'connected') {
        this.allTools.push(...connection.tools)
      }
    }
  }

  /**
   * Emit an event to the event bus if available
   */
  private emitEvent(
    type:
      | 'connected'
      | 'disconnected'
      | 'error'
      | 'reconnected'
      | 'tool:invoking'
      | 'tool:success'
      | 'tool:error',
    data: Record<string, unknown>,
  ): void {
    if (this.eventBus) {
      const eventType = `mcp:${type}` as
        | 'mcp:connected'
        | 'mcp:disconnected'
        | 'mcp:error'
        | 'mcp:reconnected'
        | 'mcp:tool:invoking'
        | 'mcp:tool:success'
        | 'mcp:tool:error'

      this.eventBus.emit({
        type: eventType,
        runId: 'mcp-client',
        timestamp: new Date().toISOString(),
        data,
      })
    }
  }

  /**
   * Simulate connection delay for async operations
   */
  private async simulateConnectionDelay(ms: number = 100): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

/**
 * Create an MCP client instance
 */
export function createMCPClient(
  serverConfigs: MCPServerConfig[],
  eventBus?: EventBus,
): MCPClient {
  return new MCPClient(serverConfigs, eventBus)
}

/**
 * Extract error message from unknown error
 */
function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}
