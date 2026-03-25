#!/usr/bin/env node
/**
 * KASO CLI Entry Point
 *
 * Commands:
 * - kaso start <spec-path>    — initiate new Execution_Run
 * - kaso status [run-id]      — display run state, phase, elapsed time, cost
 * - kaso pause <run-id>       — pause specified run
 * - kaso resume <run-id>      — resume paused run
 * - kaso cancel <run-id>      — cancel specified run
 * - kaso cost [run-id]        — display cost breakdown or aggregated history
 * - kaso history [--limit N]  — list past runs with status, duration, cost
 * - kaso logs <run-id>        — stream/display execution logs
 * - kaso watch                — start file-watcher mode
 * - kaso doctor               — verify system health
 *
 * Requirements: 28.1, 28.2, 28.3, 28.4, 28.5, 28.6, 28.7, 28.8, 28.9
 */

import { Command } from 'commander'
import { readFileSync, realpathSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

import { initializeKASO, type ApplicationContext } from '@/index'

import {
  startCommand,
  statusCommand,
  pauseCommand,
  resumeCommand,
  cancelCommand,
  costCommand,
  historyCommand,
  logsCommand,
  watchCommand,
  doctorCommand,
  type CommandContext,
} from './commands'

// ============================================================================
// Package Info
// ============================================================================

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let packageJson: { version: string; name: string; description: string }
try {
  // Try to read from dist directory first (compiled)
  const packagePath = join(__dirname, '..', '..', 'package.json')
  packageJson = JSON.parse(
    readFileSync(packagePath, 'utf8'),
  ) as typeof packageJson
} catch {
  // Fallback for development
  packageJson = {
    name: 'kaso',
    version: '0.1.0',
    description: 'Kiro-Enabled Agent Swarm Orchestrator',
  }
}

// ============================================================================
// CLI Setup
// ============================================================================

const program = new Command()

program
  .name('kaso')
  .description(packageJson.description)
  .version(packageJson.version, '-v, --version')
  .option('-c, --config <path>', 'path to config file', 'kaso.config.json')
  .option('--no-color', 'disable colored output')

// ============================================================================
// Helper to create command context
// ============================================================================

async function createContext(options: {
  config?: string
}): Promise<CommandContext> {
  const configPath = options.config ?? 'kaso.config.json'

  const appContext: ApplicationContext = await initializeKASO({
    configPath,
    enableSSE: false,
    enableWebhooks: false,
    enableFileWatcher: false,
    enableMCP: false,
  })

  return {
    orchestrator: appContext.orchestrator,
    executionStore: appContext.executionStore,
    costTracker: appContext.costTracker,
    fileWatcher: appContext.fileWatcher,
    config: appContext.config,
  }
}

// ============================================================================
// Commands
// ============================================================================

program
  .command('start')
  .description('Start a new execution run for a spec')
  .argument('<spec-path>', 'path to the Kiro spec directory')
  .option('-b, --branch <name>', 'base branch to create worktree from')
  .option('--verbose', 'enable verbose output')
  .action(
    async (
      specPath: string,
      options: { branch?: string; verbose?: boolean },
      cmd: Command,
    ) => {
      const globalOpts = cmd.optsWithGlobals<{
        config?: string
        color?: boolean
      }>()
      if (globalOpts.color === false) {
        process.env.NO_COLOR = '1'
      }

      const context = await createContext(globalOpts)
      await startCommand(context, specPath, options)
    },
  )

program
  .command('status')
  .description('Show status of a run or list all active runs')
  .argument('[run-id]', 'run ID to check (omit to list active runs)')
  .action(
    async (runId: string | undefined, _options: unknown, cmd: Command) => {
      const globalOpts = cmd.optsWithGlobals<{
        config?: string
        color?: boolean
      }>()
      if (globalOpts.color === false) {
        process.env.NO_COLOR = '1'
      }

      const context = await createContext(globalOpts)
      statusCommand(context, runId)
    },
  )

program
  .command('pause')
  .description('Pause a running execution')
  .argument('<run-id>', 'run ID to pause')
  .action(async (runId: string, _options: unknown, cmd: Command) => {
    const globalOpts = cmd.optsWithGlobals<{
      config?: string
      color?: boolean
    }>()
    if (globalOpts.color === false) {
      process.env.NO_COLOR = '1'
    }

    const context = await createContext(globalOpts)
    pauseCommand(context, runId)
  })

program
  .command('resume')
  .description('Resume a paused execution')
  .argument('<run-id>', 'run ID to resume')
  .action(async (runId: string, _options: unknown, cmd: Command) => {
    const globalOpts = cmd.optsWithGlobals<{
      config?: string
      color?: boolean
    }>()
    if (globalOpts.color === false) {
      process.env.NO_COLOR = '1'
    }

    const context = await createContext(globalOpts)
    await resumeCommand(context, runId)
  })

program
  .command('cancel')
  .description('Cancel a running or paused execution')
  .argument('<run-id>', 'run ID to cancel')
  .action(async (runId: string, _options: unknown, cmd: Command) => {
    const globalOpts = cmd.optsWithGlobals<{
      config?: string
      color?: boolean
    }>()
    if (globalOpts.color === false) {
      process.env.NO_COLOR = '1'
    }

    const context = await createContext(globalOpts)
    cancelCommand(context, runId)
  })

program
  .command('cost')
  .description('Show cost breakdown for a run or aggregated history')
  .argument('[run-id]', 'run ID to check (omit for aggregated costs)')
  .option('--history', 'show cost history instead of summary')
  .action(
    async (
      runId: string | undefined,
      options: { history?: boolean },
      cmd: Command,
    ) => {
      const globalOpts = cmd.optsWithGlobals<{
        config?: string
        color?: boolean
      }>()
      if (globalOpts.color === false) {
        process.env.NO_COLOR = '1'
      }

      const context = await createContext(globalOpts)
      costCommand(context, runId, options)
    },
  )

program
  .command('history')
  .description('List past runs with status, duration, and cost')
  .option('-l, --limit <number>', 'number of runs to show', '20')
  .action(async (options: { limit?: string }, _cmd: Command) => {
    const globalOpts = program.opts<{ config?: string; color?: boolean }>()
    if (globalOpts.color === false) {
      process.env.NO_COLOR = '1'
    }

    const context = await createContext(globalOpts)
    const limit = options.limit ? parseInt(options.limit, 10) : 20
    historyCommand(context, { limit })
  })

program
  .command('logs')
  .description('Display execution logs for a run')
  .argument('<run-id>', 'run ID to show logs for')
  .option('-p, --phase <name>', 'filter logs to specific phase')
  .option('-f, --follow', 'follow log output (not implemented)', false)
  .action(
    async (
      runId: string,
      options: { phase?: string; follow?: boolean },
      cmd: Command,
    ) => {
      const globalOpts = cmd.optsWithGlobals<{
        config?: string
        color?: boolean
      }>()
      if (globalOpts.color === false) {
        process.env.NO_COLOR = '1'
      }

      const context = await createContext(globalOpts)
      logsCommand(context, runId, options)
    },
  )

program
  .command('watch')
  .description('Start file-watcher mode for automatic spec detection')
  .action(async (_options: unknown, cmd: Command) => {
    const globalOpts = cmd.optsWithGlobals<{
      config?: string
      color?: boolean
    }>()
    if (globalOpts.color === false) {
      process.env.NO_COLOR = '1'
    }

    const context = await createContext(globalOpts)
    await watchCommand(context)
  })

program
  .command('doctor')
  .description('Verify system health and dependencies')
  .action((_options: unknown, cmd: Command) => {
    const globalOpts = cmd.optsWithGlobals<{
      config?: string
      color?: boolean
    }>()
    if (globalOpts.color === false) {
      process.env.NO_COLOR = '1'
    }

    doctorCommand()
  })

// ============================================================================
// Error Handling
// ============================================================================

program.exitOverride()

// Handle uncaught errors
process.on('unhandledRejection', (error) => {
  console.error('Unhandled error:', error)
  process.exit(1)
})

// ============================================================================
// Parse CLI arguments
// ============================================================================

if (process.argv[1] && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1])) {
  try {
    await program.parseAsync(process.argv)
  } catch (error) {
    if (error instanceof Error && 'exitCode' in error) {
      process.exit((error as { exitCode: number }).exitCode)
    }
    console.error('Error:', error)
    process.exit(1)
  }
}

export { program }
