/**
 * Configuration schema definitions for KASO
 * Uses Zod for runtime validation
 */

import { z } from 'zod'

// ============================================================================
// Base Schema Definitions
// ============================================================================

/**
 * Executor backend configuration
 */
export const ExecutorBackendConfigSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  protocol: z
    .enum(['cli-stdout', 'cli-json', 'acp', 'mcp'])
    .default('cli-json'),
  maxContextWindow: z.number().positive().default(128000),
  costPer1000Tokens: z.number().positive().default(0.01),
  enabled: z.boolean().default(true),
})

export type ExecutorBackendConfig = z.infer<typeof ExecutorBackendConfigSchema>

/**
 * Plugin configuration
 */
export const PluginConfigSchema = z.object({
  package: z.string().min(1),
  enabled: z.boolean().default(true),
  config: z.record(z.unknown()).default({}),
})

export type PluginConfig = z.infer<typeof PluginConfigSchema>

/**
 * Custom phase injection configuration
 */
export const CustomPhaseConfigSchema = z.object({
  name: z.string().regex(/^custom-[a-z0-9-]+$/),
  package: z.string().min(1),
  position: z.number().int().min(0).max(8),
  config: z.record(z.unknown()).default({}),
})

export type CustomPhaseConfig = z.infer<typeof CustomPhaseConfigSchema>

/**
 * Context capping strategy
 */
export const ContextCappingStrategySchema = z.object({
  enabled: z.boolean().default(true),
  charsPerToken: z.number().positive().default(4),
  relevanceRanking: z
    .array(z.string())
    .default([
      'design.md',
      'tech-spec.md',
      'task.md',
      'ARCHITECTURE.md',
      '.cursorrules',
      'package.json',
    ]),
})

export type ContextCappingStrategy = z.infer<
  typeof ContextCappingStrategySchema
>

/**
 * Review council configuration
 */
export const ReviewCouncilConfigSchema = z.object({
  maxReviewRounds: z.number().int().positive().default(2),
  enableParallelReview: z.boolean().default(false),
  reviewBudgetUsd: z.number().positive().optional(),
  perspectives: z
    .array(z.enum(['security', 'performance', 'maintainability']))
    .default(['security', 'performance', 'maintainability']),
})

export type ReviewCouncilConfig = z.infer<typeof ReviewCouncilConfigSchema>

/**
 * UI baseline configuration
 */
export const UIBaselineConfigSchema = z.object({
  baselineDir: z.string().default('.kiro/ui-baselines'),
  captureOnPass: z.boolean().default(true),
  diffThreshold: z.number().min(0).max(1).default(0.1),
  viewport: z.object({
    width: z.number().positive().default(1280),
    height: z.number().positive().default(720),
  }),
})

export type UIBaselineConfig = z.infer<typeof UIBaselineConfigSchema>

/**
 * Webhook configuration
 */
export const WebhookConfigSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).default(['run:completed', 'run:failed']),
  headers: z.record(z.string()).default({}),
  secret: z.string().optional(),
})

export type WebhookConfig = z.infer<typeof WebhookConfigSchema>

/**
 * SSE server configuration
 */
export const SSEConfigSchema = z.object({
  enabled: z.boolean().default(false),
  port: z.number().int().positive().default(3001),
  host: z.string().default('localhost'),
  endpoint: z.string().default('/events'),
  heartbeatIntervalMs: z.number().int().positive().default(30000),
  authToken: z.string().optional(),
  maxClients: z.number().int().positive().default(100),
})

export type SSEConfig = z.infer<typeof SSEConfigSchema>

/**
 * File watcher configuration
 */
export const FileWatcherConfigSchema = z.object({
  enabled: z.boolean().default(false),
  specsDir: z.string().default('.kiro/specs'),
  debounceMs: z.number().int().positive().default(1000),
  pollIntervalMs: z.number().int().positive().default(5000),
})

export type FileWatcherConfig = z.infer<typeof FileWatcherConfigSchema>

/**
 * MCP server configuration
 */
export const MCPServerConfigSchema = z.object({
  name: z.string().min(1),
  transport: z.enum(['stdio', 'sse', 'websocket']).default('stdio'),
  command: z.string().optional(),
  args: z.array(z.string()).default([]),
  url: z.string().optional(),
  env: z.record(z.string()).default({}),
})

export type MCPServerConfig = z.infer<typeof MCPServerConfigSchema>

/**
 * MCP tool definition
 */
export const MCPToolDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  inputSchema: z.record(z.unknown()).default({}),
  server: z.string().min(1),
})

export type MCPToolDefinition = z.infer<typeof MCPToolDefinitionSchema>

// ============================================================================
// Main Configuration Schema
// ============================================================================

/**
 * Main KASO configuration schema
 */
export const KASOConfigSchema = z.object({
  // Executor backends
  executorBackends: z.array(ExecutorBackendConfigSchema).min(1),
  defaultBackend: z.string().min(1),
  backendSelectionStrategy: z
    .enum(['default', 'context-aware'])
    .default('default'),

  // Concurrency
  maxConcurrentAgents: z
    .union([z.literal('auto'), z.number().int().positive()])
    .default('auto'),

  // Phase configuration
  maxPhaseRetries: z.number().int().min(0).default(2),
  defaultPhaseTimeout: z.number().positive().default(300),
  phaseTimeouts: z.record(z.string(), z.number().positive()).default({}),

  // Context capping
  contextCapping: ContextCappingStrategySchema.default({}),

  // Review council
  reviewCouncil: ReviewCouncilConfigSchema.default({}),

  // UI baseline
  uiBaseline: UIBaselineConfigSchema,

  // Webhooks
  webhooks: z.array(WebhookConfigSchema).default([]),

  // SSE Streaming
  sse: SSEConfigSchema.default({}).optional(),

  // File Watcher
  fileWatcher: FileWatcherConfigSchema.default({}).optional(),

  // MCP Integration
  mcpServers: z.array(MCPServerConfigSchema).default([]),

  // Plugins
  plugins: z.array(PluginConfigSchema).default([]),

  // Custom phases
  customPhases: z.array(CustomPhaseConfigSchema).default([]),

  // Cost control
  costBudgetPerRun: z.number().positive().optional(),

  // Execution store
  executionStore: z
    .object({
      type: z.enum(['sqlite', 'jsonl']).default('sqlite'),
      path: z.string().default('.kaso-execution-store.db'),
    })
    .default({}),
})

export type KASOConfig = z.infer<typeof KASOConfigSchema>

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate a KASO configuration object
 * @param config - The configuration to validate
 * @returns The validated configuration or throws an error
 */
export function validateConfig(config: unknown): KASOConfig {
  return KASOConfigSchema.parse(config)
}

/**
 * Check if a value is a valid KASO config
 * @param config - The value to check
 * @returns True if valid, false otherwise
 */
export function isValidConfig(config: unknown): config is KASOConfig {
  try {
    KASOConfigSchema.parse(config)
    return true
  } catch {
    return false
  }
}

/**
 * Get default configuration values
 * @returns Configuration with all defaults applied
 */
export function getDefaultConfig(): KASOConfig {
  return KASOConfigSchema.parse({
    executorBackends: [
      {
        name: 'kimi-code',
        command: 'kimi',
        args: [],
        protocol: 'cli-json' as const,
        maxContextWindow: 128000,
        costPer1000Tokens: 0.01,
      },
    ],
    defaultBackend: 'kimi-code',
    maxConcurrentAgents: 'auto' as const,
    maxPhaseRetries: 2,
    defaultPhaseTimeout: 300,
    contextCapping: {},
    reviewCouncil: {},
    uiBaseline: {
      baselineDir: '.kiro/ui-baselines',
      captureOnPass: true,
      diffThreshold: 0.1,
      viewport: {
        width: 1280,
        height: 720,
      },
    },
    executionStore: {},
  })
}
