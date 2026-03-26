/**
 * CLI Commands for KASO
 *
 * Implements all CLI command handlers:
 * - start: Initiate new execution run
 * - status: Display run state, phase, elapsed time, cost
 * - pause: Pause specified run
 * - resume: Resume paused run
 * - cancel: Cancel specified run
 * - cost: Display cost breakdown or aggregated history
 * - history: List past runs with status, duration, cost
 * - logs: Stream/display execution logs
 * - watch: Start file-watcher mode
 * - doctor: Verify system health
 *
 * Requirements: 28.1, 28.2, 28.3, 28.4, 28.5, 28.6, 28.7, 28.8, 28.9
 */

import type { Orchestrator } from '@/core/orchestrator'
import type { ExecutionStore } from '@/infrastructure/execution-store'
import type { CostTracker } from '@/infrastructure/cost-tracker'
import type { FileWatcher } from '@/infrastructure/file-watcher'
import type { KASOConfig } from '@/config/schema'
import type { ExecutionRunRecord, RunStatus } from '@/core/types'
import { execSync } from 'child_process'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'fs'
import { join } from 'path'

// ============================================================================
// Formatting Utilities
// ============================================================================

/**
 * Format milliseconds to human-readable duration
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`

  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)

  if (minutes < 60) {
    return `${minutes}m ${seconds}s`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  return `${hours}h ${remainingMinutes}m`
}

/**
 * Format cost to dollars
 */
export function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`
}

/**
 * Format timestamp to readable date
 */
export function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  return date.toLocaleString()
}

/**
 * Get status icon
 */
export function getStatusIcon(status: RunStatus): string {
  const icons: Record<RunStatus, string> = {
    pending: '⏳',
    running: '🔄',
    paused: '⏸️',
    completed: '✅',
    failed: '❌',
    cancelled: '🚫',
  }
  return icons[status] ?? '❓'
}

/**
 * Color codes for terminal output
 */
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
}

/**
 * Check if stdout supports colors
 */
function supportsColor(): boolean {
  return process.stdout.isTTY && process.env.NO_COLOR !== '1'
}

/**
 * Apply color if supported
 */
function color(code: keyof typeof colors, text: string): string {
  if (!supportsColor()) return text
  return `${colors[code]}${text}${colors.reset}`
}

// ============================================================================
// Command Implementations
// ============================================================================

export interface CommandContext {
  orchestrator: Orchestrator
  executionStore: ExecutionStore
  costTracker: CostTracker
  fileWatcher?: FileWatcher
  config: KASOConfig
}

/**
 * Start a new execution run
 */
export async function startCommand(
  context: CommandContext,
  specPath: string,
  options: { branch?: string; verbose?: boolean },
): Promise<void> {
  console.log(color('bold', `Starting KASO run for: ${specPath}`))

  if (options.branch) {
    console.log(color('dim', `Using base branch: ${options.branch}`))
  }

  try {
    const result = await context.orchestrator.startRun({
      specPath,
      branchName: options.branch,
    })

    console.log(color('green', `✓ Run started successfully`))
    console.log(`  Run ID: ${color('cyan', result.runId)}`)
    console.log(`  Status: ${result.status}`)
  } catch (error) {
    console.error(color('red', `Failed to start run: ${errorMessage(error)}`))
    process.exit(1)
  }
}

/**
 * Get status of a run or list all active runs
 */
export function statusCommand(context: CommandContext, runId?: string): void {
  if (runId) {
    showRunStatus(context, runId)
  } else {
    listActiveRuns(context)
  }
}

/**
 * Show detailed status for a specific run
 */
function showRunStatus(context: CommandContext, runId: string): void {
  try {
    const status = context.orchestrator.getRunStatus(runId)

    console.log(color('bold', `Run Status: ${runId}`))
    console.log(
      `  ${getStatusIcon(status.status)} ${color('bold', status.status.toUpperCase())}`,
    )
    console.log(`  Spec: ${status.specPath}`)

    if (status.currentPhase) {
      console.log(`  Current Phase: ${color('cyan', status.currentPhase)}`)
    }

    console.log(
      `  Elapsed: ${color('yellow', formatDuration(status.elapsedMs))}`,
    )
    console.log(`  Cost: ${color('green', formatCost(status.cost))}`)

    if (status.phaseResults.length > 0) {
      console.log(color('bold', '\nPhase Results:'))
      for (const result of status.phaseResults) {
        const icon =
          result.status === 'success'
            ? '✓'
            : result.status === 'failure'
              ? '✗'
              : '○'
        const duration = result.duration
          ? ` (${formatDuration(result.duration)})`
          : ''
        console.log(`  ${icon} ${result.phase}${duration}`)
      }
    }
  } catch (error) {
    // Try to get from store if not in active runs
    const run = context.executionStore.getRun(runId)
    if (run) {
      showStoredRunStatus(run)
    } else {
      console.error(color('red', `Run not found: ${runId}`))
      process.exit(1)
    }
  }
}

/**
 * Show status from stored run record
 */
function showStoredRunStatus(run: ExecutionRunRecord): void {
  const elapsed = run.completedAt
    ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
    : Date.now() - new Date(run.startedAt).getTime()

  console.log(color('bold', `Run Status: ${run.runId}`))
  console.log(
    `  ${getStatusIcon(run.status)} ${color('bold', run.status.toUpperCase())}`,
  )
  console.log(`  Spec: ${run.specPath}`)

  if (run.currentPhase) {
    console.log(`  Current Phase: ${color('cyan', run.currentPhase)}`)
  }

  console.log(`  Started: ${formatTimestamp(run.startedAt)}`)
  if (run.completedAt) {
    console.log(`  Completed: ${formatTimestamp(run.completedAt)}`)
  }
  console.log(`  Elapsed: ${color('yellow', formatDuration(elapsed))}`)
  console.log(`  Cost: ${color('green', formatCost(run.cost))}`)

  if (run.phaseResults.length > 0) {
    console.log(color('bold', '\nPhase Results:'))
    for (const result of run.phaseResults) {
      const icon =
        result.status === 'success'
          ? '✓'
          : result.status === 'failure'
            ? '✗'
            : '○'
      const duration = result.duration
        ? ` (${formatDuration(result.duration)})`
        : ''
      const phaseName = result.phase ?? 'unknown'
      console.log(`  ${icon} ${phaseName}${duration}`)
    }
  }
}

/**
 * List all active runs
 */
function listActiveRuns(context: CommandContext): void {
  const activeRuns = context.orchestrator.listActiveRuns()

  if (activeRuns.length === 0) {
    console.log(color('dim', 'No active runs'))
    return
  }

  console.log(color('bold', 'Active Runs:'))
  console.log()

  for (const run of activeRuns) {
    console.log(
      `  ${getStatusIcon(run.status as RunStatus)} ${color('cyan', run.runId)}`,
    )
    console.log(`     Spec: ${run.specPath}`)
    console.log(`     Status: ${run.status}`)
    console.log()
  }
}

/**
 * Pause a running execution
 */
export function pauseCommand(context: CommandContext, runId: string): void {
  try {
    const result = context.orchestrator.pauseRun(runId)
    console.log(color('green', `✓ Run paused: ${result.runId}`))
    console.log(`  Status: ${result.status}`)
    console.log(color('dim', '  Current phase will complete before pausing'))
  } catch (error) {
    console.error(color('red', `Failed to pause run: ${errorMessage(error)}`))
    process.exit(1)
  }
}

/**
 * Resume a paused execution
 */
export async function resumeCommand(
  context: CommandContext,
  runId: string,
): Promise<void> {
  try {
    console.log(color('bold', `Resuming run: ${runId}`))
    const result = await context.orchestrator.resumeRun(runId)
    console.log(color('green', `✓ Run resumed: ${result.runId}`))
    console.log(`  Status: ${result.status}`)
  } catch (error) {
    console.error(color('red', `Failed to resume run: ${errorMessage(error)}`))
    process.exit(1)
  }
}

/**
 * Cancel a running or paused execution
 */
export function cancelCommand(context: CommandContext, runId: string): void {
  try {
    const result = context.orchestrator.cancelRun(runId)
    console.log(color('yellow', `✓ Run cancelled: ${result.runId}`))
    console.log(color('dim', '  Worktree has been preserved for inspection'))
  } catch (error) {
    console.error(color('red', `Failed to cancel run: ${errorMessage(error)}`))
    process.exit(1)
  }
}

/**
 * Display cost breakdown for a run or aggregated history
 */
export function costCommand(
  context: CommandContext,
  runId?: string,
  options: { history?: boolean } = {},
): void {
  if (runId) {
    showRunCost(context, runId)
  } else if (options.history) {
    showCostHistory(context)
  } else {
    // Show aggregated cost info
    showAggregatedCosts(context)
  }
}

/**
 * Show cost for a specific run
 */
function showRunCost(context: CommandContext, runId: string): void {
  const cost = context.costTracker.getRunCost(runId)

  if (!cost) {
    console.error(color('red', `No cost data found for run: ${runId}`))
    process.exit(1)
  }

  console.log(color('bold', `Cost Breakdown: ${runId}`))
  console.log(`  Total: ${color('green', formatCost(cost.totalCost))}`)
  console.log(`  Invocations: ${cost.invocations.length}`)

  const backends = Object.entries(cost.backendCosts)
  if (backends.length > 0) {
    console.log(color('bold', '\nBy Backend:'))
    for (const [backend, backendCost] of backends) {
      console.log(`  ${backend}: ${formatCost(backendCost)}`)
    }
  }
}

/**
 * Show cost history
 */
function showCostHistory(context: CommandContext): void {
  const history = context.costTracker.getHistoricalCosts(100)

  if (history.length === 0) {
    console.log(color('dim', 'No cost history available'))
    return
  }

  console.log(color('bold', 'Cost History (last 100 invocations):'))
  console.log()

  let totalCost = 0
  for (const entry of history) {
    totalCost += entry.calculatedCost
    console.log(
      `  ${formatTimestamp(entry.timestamp)} | ${entry.backendName} | ${formatCost(entry.calculatedCost)}`,
    )
  }

  console.log()
  console.log(`  Total: ${color('green', formatCost(totalCost))}`)
}

/**
 * Show aggregated costs
 */
function showAggregatedCosts(context: CommandContext): void {
  const history = context.costTracker.getHistoricalCosts(1000)

  if (history.length === 0) {
    console.log(color('dim', 'No cost data available'))
    return
  }

  // Group by backend
  const backendCosts = new Map<string, number>()
  let totalCost = 0

  for (const entry of history) {
    const backendCurrent = backendCosts.get(entry.backendName) ?? 0
    backendCosts.set(entry.backendName, backendCurrent + entry.calculatedCost)

    totalCost += entry.calculatedCost
  }

  console.log(color('bold', 'Cost Summary'))
  console.log(`  Total Cost: ${color('green', formatCost(totalCost))}`)
  console.log(`  Total Invocations: ${history.length}`)

  if (backendCosts.size > 0) {
    console.log(color('bold', '\nBy Backend:'))
    for (const [backend, cost] of backendCosts) {
      const percentage = ((cost / totalCost) * 100).toFixed(1)
      console.log(`  ${backend}: ${formatCost(cost)} (${percentage}%)`)
    }
  }
}

/**
 * List run history
 */
export function historyCommand(
  context: CommandContext,
  options: { limit?: number } = {},
): void {
  const limit = options.limit ?? 20
  const runs = context.executionStore.getRuns(limit)

  if (runs.length === 0) {
    console.log(color('dim', 'No run history available'))
    return
  }

  console.log(color('bold', `Run History (last ${runs.length} runs):`))
  console.log()

  for (const run of runs) {
    const elapsed = run.completedAt
      ? new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()
      : run.pausedAt
        ? new Date(run.pausedAt).getTime() - new Date(run.startedAt).getTime()
        : Date.now() - new Date(run.startedAt).getTime()

    console.log(`${getStatusIcon(run.status)} ${color('cyan', run.runId)}`)
    console.log(`   Spec: ${run.specPath}`)
    console.log(
      `   Status: ${run.status} | Duration: ${formatDuration(elapsed)} | Cost: ${formatCost(run.cost)}`,
    )
    console.log()
  }
}

/**
 * Display logs for a run
 */
export function logsCommand(
  context: CommandContext,
  runId: string,
  options: { phase?: string; follow?: boolean },
): void {
  const run = context.executionStore.getRun(runId)

  if (!run) {
    console.error(color('red', `Run not found: ${runId}`))
    process.exit(1)
  }

  if (run.logs.length === 0) {
    console.log(color('dim', 'No logs available for this run'))
    return
  }

  // Filter by phase if specified
  let logs = run.logs
  if (options.phase) {
    logs = logs.filter(
      (log) =>
        log.source === options.phase || log.data?.phase === options.phase,
    )
    if (logs.length === 0) {
      console.log(color('dim', `No logs found for phase: ${options.phase}`))
      return
    }
  }

  console.log(color('bold', `Logs for run: ${runId}`))
  if (options.phase) {
    console.log(color('dim', `  Filtered to phase: ${options.phase}`))
  }
  console.log()

  for (const log of logs) {
    const timestamp = new Date(log.timestamp).toLocaleTimeString()
    const levelColor =
      log.level === 'error' ? 'red' : log.level === 'warn' ? 'yellow' : 'dim'
    const source = log.source ? `[${log.source}]` : ''

    console.log(
      `${color('dim', timestamp)} ${color(levelColor, log.level.toUpperCase())} ${source} ${log.message}`,
    )
  }
}

/**
 * Start file watcher mode
 */
export async function watchCommand(context: CommandContext): Promise<void> {
  if (!context.fileWatcher) {
    console.error(color('red', 'File watcher is not configured'))
    process.exit(1)
  }

  console.log(color('bold', 'Starting KASO file watcher mode...'))
  console.log(color('dim', 'Watching for specs ready for development'))
  console.log(color('dim', 'Press Ctrl+C to stop'))
  console.log()

  await context.fileWatcher.start(
    async (specPath: string, specName: string) => {
      console.log(
        color('cyan', `Detected ready spec: ${specName} (${specPath})`),
      )
      try {
        const result = await context.orchestrator.startRun({ specPath })
        console.log(
          color('green', `✓ Started run ${result.runId} for ${specName}`),
        )
      } catch (error) {
        console.error(
          color(
            'red',
            `Failed to start run for ${specName}: ${errorMessage(error)}`,
          ),
        )
      }
    },
  )

  // Keep process alive
  process.on('SIGINT', async () => {
    console.log()
    console.log(color('dim', 'Stopping file watcher...'))
    await context.fileWatcher?.stop()
    process.exit(0)
  })

  // Wait indefinitely
  await new Promise(() => {
    // Never resolves - keeps process alive until SIGINT
  })
}

/**
 * Initialize KASO in current directory (init command)
 * Creates .kiro/ and .kaso/ directory structure
 */
export function initCommand(): void {
  console.log(color('bold', 'Initializing KASO'))
  console.log()

  const cwd = process.cwd()
  let createdCount = 0
  let existingCount = 0

  // Create .kiro directory
  const kiroDir = join(cwd, '.kiro')
  if (!existsSync(kiroDir)) {
    mkdirSync(kiroDir, { recursive: true })
    console.log(`  ${color('green', '✓')} Created ${color('cyan', '.kiro/')}`)
    createdCount++
  } else {
    console.log(`  ${color('green', '✓')} ${color('cyan', '.kiro/')} exists`)
    existingCount++
  }

  // Create .kiro/specs directory
  const specsDir = join(kiroDir, 'specs')
  if (!existsSync(specsDir)) {
    mkdirSync(specsDir, { recursive: true })
    console.log(
      `  ${color('green', '✓')} Created ${color('cyan', '.kiro/specs/')}`,
    )
    createdCount++
  } else {
    console.log(
      `  ${color('green', '✓')} ${color('cyan', '.kiro/specs/')} exists`,
    )
    existingCount++
  }

  // Create .kiro/steering directory and default steering files
  const steeringDir = join(kiroDir, 'steering')
  if (!existsSync(steeringDir)) {
    mkdirSync(steeringDir, { recursive: true })
    console.log(
      `  ${color('green', '✓')} Created ${color('cyan', '.kiro/steering/')}`,
    )
    createdCount++
  } else {
    console.log(
      `  ${color('green', '✓')} ${color('cyan', '.kiro/steering/')} exists`,
    )
    existingCount++
  }

  // Create default steering files if they don't exist
  const steeringFiles: Array<{ name: string; content: string }> = [
    {
      name: 'coding-practices.md',
      content: `---
inclusion: always
---

# Coding Practices

## Style & Readability
- Self-documenting code first. Comments only when the "why" isn't obvious
- Meaningful names for everything
- No magic strings or magic numbers — use constants

## Architecture
- Follow existing project patterns and conventions
- DRY — extract shared logic, don't copy-paste
- Single responsibility — functions and modules do one thing well
- Favor composition over inheritance

## Quality
- Type annotations everywhere
- Handle errors explicitly — no silent catches
- Guard clauses over nested conditionals
- Early returns to reduce nesting
`,
    },
    {
      name: 'personality.md',
      content: `---
inclusion: always
---

# Personality

## Communication Style
- Be concise and clear
- Use technical terms appropriately
- Provide examples when explaining concepts
- Focus on correctness first, then style
`,
    },
    {
      name: 'commit-conventions.md',
      content: `---
inclusion: always
---

# Commit Conventions

Format: \`<type>(<scope>): <short description>\`

Types: feat, fix, refactor, test, docs, chore

Rules:
- Subject max 72 chars, imperative mood, no trailing period
- Body wraps at 80 chars
`,
    },
  ]

  for (const file of steeringFiles) {
    const filePath = join(steeringDir, file.name)
    if (!existsSync(filePath)) {
      writeFileSync(filePath, file.content)
      console.log(
        `  ${color('green', '✓')} Created ${color('cyan', `.kiro/steering/${file.name}`)}`,
      )
    }
  }

  // Create .kaso directory
  const kasoDir = join(cwd, '.kaso')
  if (!existsSync(kasoDir)) {
    mkdirSync(kasoDir, { recursive: true })
    console.log(`  ${color('green', '✓')} Created ${color('cyan', '.kaso/')}`)
    createdCount++
  } else {
    console.log(`  ${color('green', '✓')} ${color('cyan', '.kaso/')} exists`)
    existingCount++
  }

  // Create .kaso/worktrees directory
  const worktreesDir = join(kasoDir, 'worktrees')
  if (!existsSync(worktreesDir)) {
    mkdirSync(worktreesDir, { recursive: true })
    console.log(
      `  ${color('green', '✓')} Created ${color('cyan', '.kaso/worktrees/')}`,
    )
    createdCount++
  } else {
    console.log(
      `  ${color('green', '✓')} ${color('cyan', '.kaso/worktrees/')} exists`,
    )
    existingCount++
  }

  // Create minimal config file if it doesn't exist
  const configPath = join(cwd, 'kaso.config.json')
  let configCreated = false
  if (!existsSync(configPath)) {
    const minimalConfig = {
      executorBackends: [
        {
          name: 'kimi-code',
          command: 'kimi',
          args: [],
          protocol: 'cli-json',
          maxContextWindow: 128000,
          costPer1000Tokens: 0.01,
          enabled: true,
        },
      ],
      defaultBackend: 'kimi-code',
      executionStore: {
        type: 'sqlite',
        path: '.kaso/execution-store.db',
      },
    }
    writeFileSync(configPath, JSON.stringify(minimalConfig, null, 2))
    console.log(
      `  ${color('green', '✓')} Created ${color('cyan', 'kaso.config.json')}`,
    )
    configCreated = true
  } else {
    console.log(
      `  ${color('green', '✓')} ${color('cyan', 'kaso.config.json')} exists`,
    )
  }

  console.log()
  if (createdCount > 0) {
    console.log(color('green', `Created ${createdCount} directorie(s)`))
  }
  if (existingCount > 0) {
    console.log(
      color('yellow', `${existingCount} directorie(s) already existed`),
    )
  }
  if (configCreated) {
    console.log(color('green', 'Created kaso.config.json with default backend'))
  }
  console.log()
  console.log(color('bold', 'Next steps:'))
  console.log(`  1. Open Kiro and create a new feature spec`)
  console.log(
    `     (Kiro will create requirements.md, design.md, and tasks.md)`,
  )
  console.log(
    `  2. Run: ${color('cyan', 'kaso start .kiro/specs/<feature-name>')}`,
  )
}

/**
 * System health check (doctor command)
 */
export function doctorCommand(context?: CommandContext): void {
  console.log(color('bold', 'KASO System Health Check'))
  console.log()

  const checks: Array<{
    name: string
    status: 'pass' | 'fail' | 'warn'
    message: string
    hint?: string
  }> = []

  // Check 1: Git installation and version
  try {
    const gitVersion = execSync('git --version', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    const versionMatch = gitVersion.match(/(\d+)\.(\d+)/)
    if (versionMatch) {
      const major = parseInt(versionMatch[1]!, 10)
      const minor = parseInt(versionMatch[2]!, 10)
      if (major > 2 || (major === 2 && minor >= 40)) {
        checks.push({
          name: 'Git',
          status: 'pass',
          message: `Git ${major}.${minor}+ installed`,
        })
      } else {
        checks.push({
          name: 'Git',
          status: 'warn',
          message: `Git ${major}.${minor} installed (2.40+ recommended)`,
          hint: 'Upgrade Git to version 2.40 or later for best compatibility',
        })
      }
    }
  } catch {
    checks.push({
      name: 'Git',
      status: 'fail',
      message: 'Git not found',
      hint: 'Install Git: https://git-scm.com/downloads',
    })
  }

  // Check 2: Kimi Code CLI
  try {
    execSync('which kimi', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    // Try to check auth status
    try {
      execSync('kimi auth status', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
        timeout: 5000,
      })
      checks.push({
        name: 'Kimi Code CLI',
        status: 'pass',
        message: 'Kimi Code CLI found and authenticated',
      })
    } catch {
      checks.push({
        name: 'Kimi Code CLI',
        status: 'warn',
        message: 'Kimi Code CLI found but authentication status unknown',
        hint: 'Run `kimi auth login` to authenticate',
      })
    }
  } catch {
    checks.push({
      name: 'Kimi Code CLI',
      status: 'warn',
      message: 'Kimi Code CLI not found in PATH',
      hint: 'Install Kimi Code CLI or configure alternative backend in kaso.config.json',
    })
  }

  // Check 3: API Keys
  const requiredKeys = ['KIMI_API_KEY']
  const optionalKeys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY']
  const missingRequired: string[] = []
  const foundOptional: string[] = []

  for (const key of requiredKeys) {
    if (!process.env[key]) {
      missingRequired.push(key)
    }
  }

  for (const key of optionalKeys) {
    if (process.env[key]) {
      foundOptional.push(key)
    }
  }

  if (missingRequired.length === 0) {
    checks.push({
      name: 'API Keys',
      status: 'pass',
      message: 'Required API keys configured',
    })
  } else {
    checks.push({
      name: 'API Keys',
      status: 'fail',
      message: `Missing required keys: ${missingRequired.join(', ')}`,
      hint: 'Set environment variables or configure via OS keychain',
    })
  }

  // Check 4: Database connectivity
  if (context) {
    try {
      // Try to access the execution store
      context.executionStore.getRuns(1)
      checks.push({
        name: 'Database',
        status: 'pass',
        message: 'Execution store accessible',
      })
    } catch {
      checks.push({
        name: 'Database',
        status: 'fail',
        message: 'Cannot access execution store',
        hint: 'Check file permissions and disk space',
      })
    }

    // Check 5: Configuration
    if (context.config.executorBackends.length > 0) {
      checks.push({
        name: 'Configuration',
        status: 'pass',
        message: `${context.config.executorBackends.length} backend(s) configured`,
      })
    } else {
      checks.push({
        name: 'Configuration',
        status: 'fail',
        message: 'No executor backends configured',
        hint: 'Create kaso.config.json with at least one backend',
      })
    }
  } else {
    checks.push({
      name: 'Database',
      status: 'warn',
      message: 'Database check skipped (no context)',
    })
    checks.push({
      name: 'Configuration',
      status: 'warn',
      message: 'Configuration check skipped (no context)',
    })
  }

  // Check 6: Node.js version
  const nodeVersion = process.version
  const versionMatch = nodeVersion.match(/v(\d+)/)
  if (versionMatch) {
    const major = parseInt(versionMatch[1]!, 10)
    if (major >= 18) {
      checks.push({
        name: 'Node.js',
        status: 'pass',
        message: `Node.js ${nodeVersion} installed`,
      })
    } else {
      checks.push({
        name: 'Node.js',
        status: 'fail',
        message: `Node.js ${nodeVersion} installed (18+ required)`,
        hint: 'Upgrade Node.js: https://nodejs.org/',
      })
    }
  }

  // Check 7: .kaso directory
  const kasoDir = join(process.cwd(), '.kaso')
  if (existsSync(kasoDir)) {
    checks.push({
      name: 'KASO Directory',
      status: 'pass',
      message: '.kaso directory exists',
    })
  } else {
    checks.push({
      name: 'KASO Directory',
      status: 'warn',
      message: '.kaso directory not found',
      hint: 'Run `kaso init` or create .kaso directory manually',
    })
  }

  // Check 8: .kiro directory (required for specs)
  const kiroDir = join(process.cwd(), '.kiro')
  if (existsSync(kiroDir)) {
    // Check for specs
    const specsDir = join(kiroDir, 'specs')
    if (existsSync(specsDir)) {
      try {
        const specs = readdirSync(specsDir, { withFileTypes: true })
          .filter((dirent) => dirent.isDirectory())
          .map((dirent) => dirent.name)

        if (specs.length > 0) {
          checks.push({
            name: 'Kiro Specs',
            status: 'pass',
            message: `${specs.length} spec(s) found: ${specs.join(', ')}`,
          })
        } else {
          checks.push({
            name: 'Kiro Specs',
            status: 'warn',
            message: '.kiro/specs directory exists but is empty',
            hint: 'Create spec directories under .kiro/specs/ to define features',
          })
        }
      } catch {
        checks.push({
          name: 'Kiro Specs',
          status: 'warn',
          message: 'Cannot read .kiro/specs directory',
          hint: 'Check directory permissions',
        })
      }
    } else {
      checks.push({
        name: 'Kiro Specs',
        status: 'warn',
        message: '.kiro directory exists but specs/ subdirectory not found',
        hint: 'Create .kiro/specs/ directory for feature specifications',
      })
    }
  } else {
    checks.push({
      name: 'Kiro Directory',
      status: 'fail',
      message: '.kiro directory not found',
      hint: 'KASO requires .kiro/ directory with specs. Run `kaso init` or create it manually',
    })
  }

  // Display results
  let passCount = 0
  let failCount = 0
  let warnCount = 0

  for (const check of checks) {
    const icon =
      check.status === 'pass' ? '✓' : check.status === 'fail' ? '✗' : '⚠'
    const colorCode =
      check.status === 'pass'
        ? 'green'
        : check.status === 'fail'
          ? 'red'
          : 'yellow'

    console.log(`${icon} ${color(colorCode, check.name)}: ${check.message}`)

    if (check.hint) {
      console.log(`  ${color('dim', `Hint: ${check.hint}`)}`)
    }

    if (check.status === 'pass') passCount++
    if (check.status === 'fail') failCount++
    if (check.status === 'warn') warnCount++
  }

  console.log()
  console.log(color('bold', 'Summary:'))
  console.log(
    `  ${color('green', `${passCount} passed`)}, ${color('red', `${failCount} failed`)}, ${color('yellow', `${warnCount} warnings`)}`,
  )

  if (failCount > 0) {
    console.log()
    console.log(
      color('red', 'Some checks failed. Please fix the issues above.'),
    )
    process.exit(1)
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Extract error message from unknown error
 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
