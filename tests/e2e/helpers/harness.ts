/**
 * E2E Test Harness
 *
 * Top-level test utility that orchestrates fixture creation and KASO initialization.
 * The mock project creates spec files in a temp directory with proper .kiro/specs/
 * structure, and SpecReaderAgent reads from context.spec.specPath at runtime.
 *
 * Requirements: 1.1–1.6, 2.1–2.7
 */

import { initializeKASO, shutdownKASO } from '@/index'
import type { ApplicationContext } from '@/index'
import type { KASOConfig } from '@/config/schema'
import type { MockBackendPreset } from './mock-backend'
import { MockBackend } from './mock-backend'
import type { MockBackendConfig } from './mock-backend'
import { createMockProject, type MockProjectConfig } from './mock-project'
import type { MockProjectResult } from './mock-project'
import { EventCollector } from './event-collector'
import { PhaseValidator } from './phase-validator'
import { createDefaultPhaseResponses } from './phase-outputs'
import type { PhaseName } from '@/core/types'
import { WebhookReceiver } from './webhook-receiver'
import { execSync } from 'child_process'
import { existsSync, rmSync, readdirSync } from 'fs'

/**
 * Options for harness setup
 */
export interface HarnessOptions {
  /** Override config values */
  configOverrides?: Partial<KASOConfig>
  /** Number of mock backends to register */
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
  /** Custom feature name for mock spec */
  featureName?: string
  /** Custom spec content */
  specContent?: MockProjectConfig['specContent']
  /** When true, skip git branch/worktree cleanup on teardown (for debugging) */
  preserveArtifacts?: boolean
}

/**
 * Context returned by harness setup
 */
export interface HarnessContext {
  /** The initialized KASO ApplicationContext */
  app: ApplicationContext
  /** Path to the temporary project directory */
  projectDir: string
  /** Path to the mock spec directory */
  specPath: string
  /** Registered mock backends by name */
  backends: Map<string, MockBackend>
  /** Event collector subscribed to EventBus */
  eventCollector: EventCollector
  /** Phase validator for ExecutionStore queries */
  phaseValidator: PhaseValidator
  /** Webhook receiver (if enabled) */
  webhookReceiver?: WebhookReceiver
  /** Mock project result for cleanup */
  mockProject: MockProjectResult
  /** Feature name used for this harness (for git cleanup) */
  featureName: string
  /** When true, skip git branch/worktree cleanup on teardown */
  preserveArtifacts: boolean
}

/**
 * Create and configure the E2E test harness
 * @param options - Harness configuration options
 * @returns Promise resolving to harness context
 */
export async function setupHarness(
  options: HarnessOptions = {},
): Promise<HarnessContext> {
  const featureName = options.featureName ?? 'e2e-test-feature'

  // Create mock project with spec files in proper .kiro/specs/ structure
  const mockProject = await createMockProject({
    featureName,
    specContent: options.specContent,
    configOverrides: options.configOverrides,
  })

  try {
    // Step 1: Initialize KASO with the generated config
    const app = await initializeKASO({
      configPath: mockProject.configPath,
      enableSSE: options.enableSSE,
      enableWebhooks: options.enableWebhooks,
      enableFileWatcher: options.enableFileWatcher,
      enableMCP: options.enableMCP,
    })

    // Step 2: Create and register mock backends
    const backends = new Map<string, MockBackend>()
    const backendCount = options.backendCount ?? 1

    for (let i = 0; i < backendCount; i++) {
      const backendName = i === 0 ? 'mock-backend' : `mock-backend-${i + 1}`
      const config: MockBackendConfig = {
        name: backendName,
        maxContextWindow: 128000 - i * 32000,
        costPer1000Tokens: 0.01 + i * 0.005,
      }

      const backend = new MockBackend(config)

      // Apply default phase responses
      const defaultResponses = createDefaultPhaseResponses()
      for (const [phase, response] of defaultResponses) {
        backend.setPhaseResponse(phase, response)
      }

      // Apply preset configurations if provided
      const preset = options.backendPresets?.find((p) => p.name === backendName)
      if (preset) {
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

      // Register with backend registry
      app.backendRegistry.registerBackend(backendName, backend)
      backends.set(backendName, backend)
    }

    // Step 3: Create test utilities
    const eventCollector = new EventCollector(app.eventBus)
    const phaseValidator = new PhaseValidator(app.executionStore)

    // Step 4: Setup webhook receiver if enabled
    let webhookReceiver: WebhookReceiver | undefined
    if (options.enableWebhooks) {
      webhookReceiver = new WebhookReceiver()
      await webhookReceiver.start()
    }

    return {
      app,
      projectDir: mockProject.projectDir,
      specPath: mockProject.specPath,
      backends,
      eventCollector,
      phaseValidator,
      webhookReceiver,
      mockProject,
      featureName,
      preserveArtifacts: options.preserveArtifacts ?? false,
    }
  } catch (error) {
    await mockProject.cleanup()
    throw error
  }
}

/**
 * Tear down the E2E test harness
 * @param ctx - Harness context to tear down
 */
export async function teardownHarness(ctx: HarnessContext): Promise<void> {
  if (ctx.webhookReceiver) {
    await ctx.webhookReceiver.stop()
  }

  ctx.eventCollector.dispose()
  await shutdownKASO(ctx.app)
  await ctx.mockProject.cleanup()

  // Clean up git worktrees and branches created during this test run
  if (!ctx.preserveArtifacts) {
    cleanupGitArtifacts(ctx.featureName)
    cleanupSpecDirectory(ctx.featureName)
  }
}

/**
 * Helper to configure a backend for a specific phase response
 */
export function configurePhaseResponse(
  ctx: HarnessContext,
  backendName: string,
  phase: PhaseName,
  success: boolean,
  output?: Record<string, unknown>,
  tokensUsed?: number,
): void {
  const backend = ctx.backends.get(backendName)
  if (!backend) {
    throw new Error(`Backend '${backendName}' not found`)
  }

  backend.setPhaseResponse(phase, {
    success,
    output,
    tokensUsed,
  })
}

/**
 * Helper to configure a backend for failure
 */
export function configurePhaseFailure(
  ctx: HarnessContext,
  backendName: string,
  phase: PhaseName,
  error: string,
  retryable = false,
): void {
  const backend = ctx.backends.get(backendName)
  if (!backend) {
    throw new Error(`Backend '${backendName}' not found`)
  }

  backend.setPhaseResponse(phase, {
    success: false,
    error,
    retryable,
  })
}

/**
 * Remove the .kiro/specs/{featureName} directory created by SpecWriter during the run.
 * The orchestrator writes execution-log.md and status.json to CWD's .kiro/specs/
 * when the specPath contains '.kiro/specs/'.
 */
function cleanupSpecDirectory(featureName: string): void {
  const specDir = `.kiro/specs/${featureName}`
  if (existsSync(specDir)) {
    try {
      rmSync(specDir, { recursive: true, force: true })
    } catch {
      // best effort
    }
  }
}

/**
 * Remove git worktrees and branches matching a feature name pattern.
 * Silently ignores errors — best-effort cleanup.
 */
function cleanupGitArtifacts(featureName: string): void {
  const branchPrefix = `kaso/${featureName}-`

  // 1. Remove worktree directories matching this feature
  const worktreeDir = '.kaso/worktrees'
  if (existsSync(worktreeDir)) {
    try {
      const entries = execSync(`ls "${worktreeDir}"`, { encoding: 'utf-8' })
        .trim()
        .split('\n')
        .filter(Boolean)

      for (const entry of entries) {
        if (entry.startsWith(featureName)) {
          const wtPath = `${worktreeDir}/${entry}`
          try {
            execSync(`git worktree remove --force "${wtPath}" 2>/dev/null`, {
              encoding: 'utf-8',
            })
          } catch {
            // Worktree may already be gone from shutdownKASO; remove dir manually
            if (existsSync(wtPath)) {
              rmSync(wtPath, { recursive: true, force: true })
            }
          }
        }
      }
      // Prune stale worktree refs
      try {
        execSync('git worktree prune 2>/dev/null', { encoding: 'utf-8' })
      } catch {
        // best effort
      }
    } catch {
      // best effort
    }
  }

  // 2. Delete branches matching kaso/{featureName}-*
  try {
    const branches = execSync('git branch', { encoding: 'utf-8' })
      .split('\n')
      .map((b) => b.trim().replace(/^\*?\s*\+?\s*/, ''))
      .filter((b) => b.startsWith(branchPrefix))

    for (const branch of branches) {
      try {
        execSync(`git branch -D "${branch}" 2>/dev/null`, { encoding: 'utf-8' })
      } catch {
        // branch may already be gone
      }
    }
  } catch {
    // best effort
  }
}

/**
 * Nuclear cleanup: remove ALL kaso/* worktrees and branches.
 * Call this to clean up stale artifacts from previous test runs.
 *
 * Usage in a test file:
 *   import { cleanupAllTestArtifacts } from './helpers/harness'
 *   beforeAll(() => cleanupAllTestArtifacts())
 *
 * Or from CLI:
 *   npx tsx -e "import('./tests/e2e/helpers/harness').then(m => m.cleanupAllTestArtifacts())"
 */
export function cleanupAllTestArtifacts(): void {
  // 1. Remove all worktrees under .kaso/worktrees/
  const worktreeDir = '.kaso/worktrees'
  if (existsSync(worktreeDir)) {
    try {
      const entries = execSync(`ls "${worktreeDir}"`, { encoding: 'utf-8' })
        .trim()
        .split('\n')
        .filter(Boolean)

      for (const entry of entries) {
        const wtPath = `${worktreeDir}/${entry}`
        try {
          execSync(`git worktree remove --force "${wtPath}" 2>/dev/null`, {
            encoding: 'utf-8',
          })
        } catch {
          if (existsSync(wtPath)) {
            rmSync(wtPath, { recursive: true, force: true })
          }
        }
      }
      execSync('git worktree prune 2>/dev/null', { encoding: 'utf-8' })
    } catch {
      // best effort
    }
  }

  // 2. Delete all kaso/* branches
  try {
    const branches = execSync('git branch', { encoding: 'utf-8' })
      .split('\n')
      .map((b) => b.trim().replace(/^\*?\s*\+?\s*/, ''))
      .filter((b) => b.startsWith('kaso/'))

    for (const branch of branches) {
      try {
        execSync(`git branch -D "${branch}" 2>/dev/null`, { encoding: 'utf-8' })
      } catch {
        // best effort
      }
    }
  } catch {
    // best effort
  }

  // 3. Remove spec directories created by SpecWriter during test runs.
  //    These contain status.json (written by SpecWriter) — real spec dirs don't.
  const specsDir = '.kiro/specs'
  if (existsSync(specsDir)) {
    try {
      const entries = readdirSync(specsDir)
      for (const entry of entries) {
        const statusFile = `${specsDir}/${entry}/status.json`
        if (existsSync(statusFile)) {
          rmSync(`${specsDir}/${entry}`, { recursive: true, force: true })
        }
      }
    } catch {
      // best effort
    }
  }
}
