/**
 * KASO - Kiro-Enabled Agent Swarm Orchestrator
 * Main Application Entry Point
 *
 * Wires all components together:
 * config loader → credential manager → execution store → checkpoint manager →
 * worktree manager → event bus → concurrency manager → agent registry →
 * backend registry → cost tracker → orchestrator → file watcher →
 * SSE server → webhook dispatcher → CLI
 *
 * Requirements: All
 */

import { loadConfig } from '@/config/loader'
import { EventBus } from '@/core/event-bus'
import { StateMachine } from '@/core/state-machine'
import { ConcurrencyManager } from '@/core/concurrency-manager'
import { createOrchestrator } from '@/core/orchestrator'
import { AgentRegistryImpl } from '@/agents/agent-registry'
import { createAgent, type AgentDependencies } from '@/agents/agent-interface'
import { ExecutionStore } from '@/infrastructure/execution-store'
import { CheckpointManager } from '@/infrastructure/checkpoint-manager'
import { WorktreeManager } from '@/infrastructure/worktree-manager'
import { CostTracker } from '@/infrastructure/cost-tracker'
import { SpecWriter } from '@/infrastructure/spec-writer'
import type { WebhookDispatcher } from '@/infrastructure/webhook-dispatcher'
import type { FileWatcher } from '@/infrastructure/file-watcher'
import { MCPClient } from '@/infrastructure/mcp-client'
import { BackendRegistry } from '@/backends/backend-registry'
import { createPluginLoader } from '@/plugins/plugin-loader'
import { createPhaseInjector } from '@/plugins/phase-injector'
import type { SSEServer } from '@/streaming/sse-server'
import type { KASOConfig } from '@/config/schema'
import type { PhaseName } from '@/core/types'
import { cpus } from 'os'

// ============================================================================
// Application Context
// ============================================================================

export interface ApplicationContext {
  config: KASOConfig
  eventBus: EventBus
  executionStore: ExecutionStore
  checkpointManager: CheckpointManager
  worktreeManager: WorktreeManager
  costTracker: CostTracker
  concurrencyManager: ConcurrencyManager
  backendRegistry: BackendRegistry
  agentRegistry: AgentRegistryImpl
  specWriter: SpecWriter
  webhookDispatcher?: WebhookDispatcher
  fileWatcher?: FileWatcher
  sseServer?: SSEServer
  mcpClient?: MCPClient
  orchestrator: ReturnType<typeof createOrchestrator>
}

// ============================================================================
// Built-in Phases
// ============================================================================

const BUILTIN_PHASES: PhaseName[] = [
  'intake',
  'validation',
  'architecture-analysis',
  'implementation',
  'architecture-review',
  'test-verification',
  'ui-validation',
  'review-delivery',
]

// ============================================================================
// Application Initialization
// ============================================================================

export interface InitializeOptions {
  configPath?: string
  config?: KASOConfig
  enableSSE?: boolean
  enableWebhooks?: boolean
  enableFileWatcher?: boolean
  enableMCP?: boolean
}

/**
 * Initialize the KASO application with all components wired together
 */
export async function initializeKASO(
  options: InitializeOptions = {},
): Promise<ApplicationContext> {
  // Load configuration from file or use provided config
  let config: KASOConfig
  if (options.config) {
    config = options.config
  } else {
    const configPath = options.configPath ?? 'kaso.config.json'
    config = await loadConfig({ configPath })
  }

  // Initialize core infrastructure
  const eventBus = new EventBus()
  const executionStore = new ExecutionStore(config.executionStore)
  const checkpointManager = new CheckpointManager(executionStore)
  const worktreeManager = new WorktreeManager()
  const costTracker = new CostTracker()

  // Initialize concurrency manager
  const maxConcurrent =
    config.maxConcurrentAgents === 'auto'
      ? Math.max(1, cpus().length - 1)
      : config.maxConcurrentAgents
  const concurrencyManager = new ConcurrencyManager(maxConcurrent)

  // Initialize backend registry
  const backendRegistry = new BackendRegistry(config)

  // Initialize agent registry and register built-in agents
  const agentRegistry = new AgentRegistryImpl()
  const agentDeps: AgentDependencies = { eventBus, backendRegistry }
  registerBuiltinAgents(agentRegistry, config, agentDeps)

  // Initialize plugins and custom phases
  const phaseInjector = createPhaseInjector(config.customPhases ?? [])
  phaseInjector.buildPipeline()

  if (config.plugins && config.plugins.length > 0) {
    const pluginLoader = createPluginLoader(agentRegistry, config.plugins)
    await pluginLoader.loadAndRegister()

    // Validate custom phases have agents
    const validation = phaseInjector.validateAgents(
      new Set(agentRegistry.listRegistered().map((m) => m.phase)),
    )
    if (!validation.valid) {
      console.warn(
        `Warning: Custom phases without agents: ${validation.missing.join(', ')}`,
      )
    }
  }

  // Initialize spec writer
  const specWriter = new SpecWriter()

  // Initialize optional components
  let webhookDispatcher: WebhookDispatcher | undefined
  let fileWatcher: FileWatcher | undefined
  let sseServer: SSEServer | undefined
  let mcpClient: MCPClient | undefined

  // Initialize webhook dispatcher
  if (
    options.enableWebhooks !== false &&
    config.webhooks &&
    config.webhooks.length > 0
  ) {
    const { WebhookDispatcher } =
      await import('./infrastructure/webhook-dispatcher')
    webhookDispatcher = new WebhookDispatcher(
      { webhooks: config.webhooks },
      { eventBus },
    )
    await webhookDispatcher.start()
  }

  // Initialize file watcher
  if (options.enableFileWatcher !== false && config.fileWatcher?.enabled) {
    const { FileWatcher } = await import('./infrastructure/file-watcher')
    fileWatcher = new FileWatcher(config.fileWatcher, eventBus)
  }

  // Initialize SSE server
  if (options.enableSSE !== false && config.sse?.enabled) {
    const { SSEServer } = await import('./streaming/sse-server')
    sseServer = new SSEServer(eventBus, config.sse)
    await sseServer.start()
  }

  // Initialize MCP client
  if (
    options.enableMCP !== false &&
    config.mcpServers &&
    config.mcpServers.length > 0
  ) {
    mcpClient = new MCPClient(config.mcpServers, eventBus)
    await mcpClient.initialize()
  }

  // Create state machine
  const stateMachine = new StateMachine()

  // Create orchestrator with all dependencies
  const orchestrator = createOrchestrator({
    eventBus,
    stateMachine,
    agentRegistry,
    executionStore,
    checkpointManager,
    worktreeManager,
    costTracker,
    concurrencyManager,
    backendRegistry,
    specWriter,
    config,
  })

  // Connect MCP client to orchestrator if available
  if (mcpClient) {
    orchestrator.setMCPClient(mcpClient)
  }

  // Wire file watcher to orchestrator — spec ready triggers startRun
  if (fileWatcher) {
    await fileWatcher.start(async (specPath: string, _specName: string) => {
      try {
        await orchestrator.startRun({ specPath })
      } catch (error) {
        console.error(
          `Failed to start run for spec ${specPath}:`,
          error instanceof Error ? error.message : String(error),
        )
      }
    })
  }

  // Run crash recovery
  console.log('Running crash recovery...')
  const recoveredRuns = await orchestrator.recoverInterruptedRuns()
  if (recoveredRuns.length > 0) {
    console.log(
      `Recovered ${recoveredRuns.length} interrupted runs:`,
      recoveredRuns,
    )
  }

  const context: ApplicationContext = {
    config,
    eventBus,
    executionStore,
    checkpointManager,
    worktreeManager,
    costTracker,
    concurrencyManager,
    backendRegistry,
    agentRegistry,
    specWriter,
    webhookDispatcher,
    fileWatcher,
    sseServer,
    mcpClient,
    orchestrator,
  }

  console.log('KASO initialized successfully')
  return context
}

/**
 * Register all built-in agents with the agent registry
 */
function registerBuiltinAgents(
  registry: AgentRegistryImpl,
  config: KASOConfig,
  deps: AgentDependencies,
): void {
  for (const phase of BUILTIN_PHASES) {
    const agent = createAgent(phase, config, deps)
    registry.register(phase, agent, phase)
  }
  console.log(`Registered ${BUILTIN_PHASES.length} built-in agents`)
}

// ============================================================================
// Application Shutdown
// ============================================================================

/**
 * Gracefully shut down the KASO application
 */
export async function shutdownKASO(context: ApplicationContext): Promise<void> {
  console.log('Shutting down KASO...')

  // Stop optional services
  if (context.fileWatcher) {
    await context.fileWatcher.stop()
    console.log('File watcher stopped')
  }

  if (context.sseServer) {
    await context.sseServer.stop()
    console.log('SSE server stopped')
  }

  if (context.webhookDispatcher) {
    await context.webhookDispatcher.stop()
    console.log('Webhook dispatcher stopped')
  }

  if (context.mcpClient) {
    await context.mcpClient.disconnect()
    console.log('MCP client disconnected')
  }

  // Force-cleanup all remaining worktrees (including retained ones)
  const remainingWorktrees = context.worktreeManager.listWorktrees()
  for (const wt of remainingWorktrees) {
    try {
      await context.worktreeManager.cleanup(wt.runId, true)
    } catch {
      // Best-effort cleanup during shutdown
    }
  }

  console.log('KASO shutdown complete')
}

// ============================================================================
// Health Check
// ============================================================================

export interface HealthStatus {
  healthy: boolean
  components: {
    config: boolean
    executionStore: boolean
    orchestrator: boolean
  }
  details?: string
}

/**
 * Check the health of the KASO application
 */
export function checkHealth(context: ApplicationContext): HealthStatus {
  const status: HealthStatus = {
    healthy: true,
    components: {
      config: !!context.config,
      executionStore: !!context.executionStore,
      orchestrator: !!context.orchestrator,
    },
  }

  status.healthy = Object.values(status.components).every((v) => v)

  if (!status.healthy) {
    const failed = Object.entries(status.components)
      .filter(([, v]) => !v)
      .map(([k]) => k)
    status.details = `Failed components: ${failed.join(', ')}`
  }

  return status
}

// ============================================================================
// Default Export
// ============================================================================

export default {
  initialize: initializeKASO,
  shutdown: shutdownKASO,
  checkHealth,
}

// Export all public APIs
export * from './config/loader'
export * from './config/schema'
export * from './core/types'
export * from './core/orchestrator'
export * from './agents/agent-interface'
export * from './infrastructure/mcp-client'
export * from './plugins/plugin-loader'
export * from './plugins/phase-injector'
