/**
 * E2E Test Harness
 *
 * Top-level test utility that creates a mock project, initializes KASO
 * via initializeKASO(), registers mock backends, and wires up event
 * collection and phase validation for E2E tests.
 *
 * Requirements: 1.1–1.6, 2.1–2.7
 */

import { initializeKASO, shutdownKASO, type ApplicationContext } from '@/index'
import type { KASOConfig } from '@/config/schema'
import type { PhaseName, PhaseOutput } from '@/core/types'
import { createMockProject, type MockProjectResult } from './mock-project'
import {
  MockBackend,
  type MockBackendConfig,
  type MockBackendPreset,
} from './mock-backend'
import { createDefaultPhaseResponses } from './phase-outputs'
import { EventCollector } from './event-collector'
import { PhaseValidator } from './phase-validator'

/** Options for configuring the test harness */
export interface HarnessOptions {
  /** Override config values */
  configOverrides?: Partial<KASOConfig>
  /** Number of mock backends to register (default 1) */
  backendCount?: number
  /** Backend behavior presets */
  backendPresets?: MockBackendPreset[]
  /** Enable SSE server */
  enableSSE?: boolean
  /** Enable webhooks with local receiver */
  enableWebhooks?: boolean
  /** Enable file watcher */
  enableFileWatcher?: boolean
  /** Enable MCP client */
  enableMCP?: boolean
}

/** Context returned by setupHarness for use in tests */
export interface HarnessContext {
  app: ApplicationContext
  projectDir: string
  specPath: string
  backends: Map<string, MockBackend>
  eventCollector: EventCollector
  phaseValidator: PhaseValidator
}

const DEFAULT_BACKEND_NAME = 'mock-backend'
const DEFAULT_MAX_CONTEXT_WINDOW = 128000
const DEFAULT_COST_PER_1K_TOKENS = 0.01

/** Internal state for cleanup tracking */
interface HarnessInternals {
  mockProject: MockProjectResult
}

const internalsMap = new WeakMap<HarnessContext, HarnessInternals>()

/**
 * Create and initialize a full E2E test harness
 *
 * Sets up a mock project, initializes KASO with in-memory SQLite,
 * registers mock backends, and attaches event collection + phase validation.
 */
export async function setupHarness(
  options: HarnessOptions = {},
): Promise<HarnessContext> {
  const backendCount = options.backendCount ?? 1

  // Build backend configs for the KASO config
  const backendConfigs = buildBackendConfigs(backendCount)

  // Create mock project with temp directory
  const mockProject = await createMockProject({
    configOverrides: {
      executorBackends: backendConfigs.map((bc) => ({
        name: bc.name,
        command: 'echo',
        args: [],
        protocol: bc.protocol ?? 'cli-json',
        maxContextWindow: bc.maxContextWindow ?? DEFAULT_MAX_CONTEXT_WINDOW,
        costPer1000Tokens: bc.costPer1000Tokens ?? DEFAULT_COST_PER_1K_TOKENS,
        enabled: true,
      })),
      defaultBackend: DEFAULT_BACKEND_NAME,
      ...options.configOverrides,
    },
  })

  // Load the generated config from the mock project
  const app = await initializeKASO({
    configPath: mockProject.configPath,
    enableSSE: options.enableSSE ?? false,
    enableWebhooks: options.enableWebhooks ?? false,
    enableFileWatcher: options.enableFileWatcher ?? false,
    enableMCP: options.enableMCP ?? false,
  })

  // Create and register mock backends, replacing the CLI stubs
  const backends = new Map<string, MockBackend>()
  const defaultResponses = createDefaultPhaseResponses()

  for (const bc of backendConfigs) {
    const mockBackend = new MockBackend(bc)

    // Apply preset if provided
    const preset = options.backendPresets?.find((p) => p.name === bc.name)
    if (preset) {
      applyPreset(mockBackend, preset)
    } else {
      // Wire default phase responses for the primary backend
      for (const [phase, response] of defaultResponses) {
        mockBackend.setPhaseResponse(phase, response)
      }
    }

    app.backendRegistry.registerBackend(bc.name, mockBackend)
    backends.set(bc.name, mockBackend)
  }

  // Attach event collector and phase validator
  const eventCollector = new EventCollector(app.eventBus)
  const phaseValidator = new PhaseValidator(app.executionStore)

  const ctx: HarnessContext = {
    app,
    projectDir: mockProject.projectDir,
    specPath: mockProject.specPath,
    backends,
    eventCollector,
    phaseValidator,
  }

  internalsMap.set(ctx, { mockProject })
  return ctx
}

/**
 * Tear down the harness: shutdown KASO, clean up temp dirs and worktrees
 */
export async function teardownHarness(ctx: HarnessContext): Promise<void> {
  // Dispose event collector first
  ctx.eventCollector.dispose()

  // Shutdown KASO (stops optional services, cleans worktrees)
  try {
    await shutdownKASO(ctx.app)
  } catch {
    // Best-effort shutdown
  }

  // Close execution store
  try {
    ctx.app.executionStore.close()
  } catch {
    // Best-effort close
  }

  // Remove temp project directory
  const internals = internalsMap.get(ctx)
  if (internals) {
    await internals.mockProject.cleanup()
    internalsMap.delete(ctx)
  }
}

/**
 * Configure a phase response on a specific backend in the harness
 * @throws Error if backend not found in the harness
 */
export function configurePhaseResponse(
  ctx: HarnessContext,
  backendName: string,
  phase: PhaseName,
  success: boolean,
  output?: PhaseOutput,
  tokensUsed?: number,
): void {
  const backend = ctx.backends.get(backendName)
  if (!backend) {
    throw new Error(
      `Backend '${backendName}' not found in harness. Available: ${Array.from(ctx.backends.keys()).join(', ')}`,
    )
  }

  backend.setPhaseResponse(phase, {
    success,
    output,
    tokensUsed,
  })
}

/**
 * Build MockBackendConfig array for the requested backend count
 */
function buildBackendConfigs(count: number): MockBackendConfig[] {
  const configs: MockBackendConfig[] = []

  for (let i = 0; i < count; i++) {
    const suffix = i === 0 ? '' : `-${i + 1}`
    configs.push({
      name: `${DEFAULT_BACKEND_NAME}${suffix}`,
      protocol: 'cli-json',
      maxContextWindow: DEFAULT_MAX_CONTEXT_WINDOW,
      costPer1000Tokens: DEFAULT_COST_PER_1K_TOKENS,
    })
  }

  return configs
}

/**
 * Apply a MockBackendPreset to a MockBackend instance
 */
function applyPreset(backend: MockBackend, preset: MockBackendPreset): void {
  if (preset.phaseResponses) {
    for (const [phase, response] of preset.phaseResponses) {
      backend.setPhaseResponse(phase, response)
    }
  }
  if (preset.delayMs !== undefined) {
    backend.setDelay(preset.delayMs)
  }
  if (preset.available !== undefined) {
    backend.setAvailable(preset.available)
  }
}
