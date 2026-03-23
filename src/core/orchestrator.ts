/**
 * Orchestrator - Central hub for coordinating agent execution through the 8-phase pipeline
 * Implements hub-and-spoke architecture with state management, event streaming, and workflow control
 */

import { EventBus } from './event-bus'
import { StateMachine } from './state-machine'
import type { AgentRegistry } from '@/agents/agent-interface'
import { ExecutionStore } from '@/infrastructure/execution-store'
import { CheckpointManager } from '@/infrastructure/checkpoint-manager'
import { WorktreeManager } from '@/infrastructure/worktree-manager'
import { CostTracker } from '@/infrastructure/cost-tracker'
import { ConcurrencyManager } from './concurrency-manager'
import { BackendRegistry } from '@/backends/backend-registry'
import { SpecWriter } from '@/infrastructure/spec-writer'
import type { KASOConfig } from '@/config/schema'
import type {
  PhaseName,
  AgentContext,
  PhaseResult,
  PhaseOutput,
  ExecutionRunRecord,
  PhaseResultRecord,
  RunStatus,
  ParsedSpec,
  SteeringFiles,
  EventType,
  LogEntry,
} from './types'

/** Ordered list of the 8 built-in pipeline phases */
const PIPELINE_PHASES: readonly PhaseName[] = [
  'intake',
  'validation',
  'architecture-analysis',
  'implementation',
  'architecture-review',
  'test-verification',
  'ui-validation',
  'review-delivery',
] as const

const DEFAULT_COST_PER_1000_TOKENS = 0.01
const DEFAULT_PHASE_TIMEOUT_SECONDS = 300
const MS_PER_SECOND = 1000

const TERMINAL_STATUSES: readonly RunStatus[] = [
  'completed',
  'failed',
  'cancelled',
] as const

// ============================================================================
// Public interfaces
// ============================================================================

export interface StartRunOptions {
  specPath: string
  branchName?: string
  checkpoint?: boolean
}

export interface RunStatusResponse {
  runId: string
  specPath: string
  status: RunStatus
  currentPhase?: PhaseName
  elapsedMs: number
  cost: number
  phaseResults: PhaseResultRecord[]
}

// ============================================================================
// Internal types
// ============================================================================

interface RunningRunInfo {
  runId: string
  specPath: string
  status: RunStatus
  currentPhase?: PhaseName
  startTime: number
  lastUpdateTime: number
  worktreePath?: string
  /** The runId used by WorktreeManager (specName-timestamp format from create()) */
  worktreeRunId?: string
  branchName?: string
  stateMachine: StateMachine
  phaseResults: PhaseResultRecord[]
  phaseOutputs: Partial<Record<PhaseName, PhaseOutput>>
  phaseSequence: number
  logs: LogEntry[]
  pauseRequested: boolean
  cancelRequested: boolean
  /** Current phase's AbortController — replaced per phase, aborted on cancel (Req 13.5) */
  phaseAbortController?: AbortController
}

function generateRunId(specPath: string): string {
  const specName =
    specPath
      .split('/')
      .pop()
      ?.replace(/[^a-zA-Z0-9-]/g, '-') ?? 'unknown'
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).substring(2, 6)
  return `${specName}-${timestamp}-${random}`
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function nowISO(): string {
  return new Date().toISOString()
}

function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status)
}

// ============================================================================
// Orchestrator
// ============================================================================

export class Orchestrator {
  private readonly eventBus: EventBus
  private readonly agentRegistry: AgentRegistry
  private readonly executionStore: ExecutionStore
  private readonly checkpointManager: CheckpointManager
  private readonly worktreeManager: WorktreeManager
  private readonly costTracker: CostTracker
  private readonly concurrencyManager: ConcurrencyManager
  private readonly backendRegistry: BackendRegistry
  private readonly specWriter: SpecWriter
  private readonly config: KASOConfig
  private readonly runningRuns = new Map<string, RunningRunInfo>()
  private readonly queuedSpecUpdates = new Map<string, string>()

  constructor(
    eventBus: EventBus,
    _stateMachine: StateMachine,
    agentRegistry: AgentRegistry,
    executionStore: ExecutionStore,
    checkpointManager: CheckpointManager,
    worktreeManager: WorktreeManager,
    costTracker: CostTracker,
    concurrencyManager: ConcurrencyManager,
    backendRegistry: BackendRegistry,
    specWriter: SpecWriter,
    config: KASOConfig,
  ) {
    this.eventBus = eventBus
    this.agentRegistry = agentRegistry
    this.executionStore = executionStore
    this.checkpointManager = checkpointManager
    this.worktreeManager = worktreeManager
    this.costTracker = costTracker
    this.concurrencyManager = concurrencyManager
    this.backendRegistry = backendRegistry
    this.specWriter = specWriter
    this.config = config

    // _stateMachine param kept for API compat — each run creates its own instance
    this.validatePhaseAgentsRegistered()
    this.validateDependencies(_stateMachine)
  }

  /** Verify all injected dependencies are present */
  private validateDependencies(stateMachine: StateMachine): void {
    const deps: unknown[] = [
      this.eventBus,
      stateMachine,
      this.executionStore,
      this.checkpointManager,
      this.worktreeManager,
      this.costTracker,
      this.concurrencyManager,
      this.backendRegistry,
      this.specWriter,
      this.config,
    ]

    for (const dep of deps) {
      if (!dep) {
        throw new Error('Missing required dependency')
      }
    }
  }

  private validatePhaseAgentsRegistered(): void {
    for (const phase of PIPELINE_PHASES) {
      if (!this.agentRegistry.getAgentForPhase(phase)) {
        throw new Error(
          `Required agent for phase '${phase}' is not registered. ` +
            'Register all 8 phase agents before creating the orchestrator.',
        )
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Public API — Task 13.1
  // ---------------------------------------------------------------------------

  async startRun(
    options: StartRunOptions,
  ): Promise<{ runId: string; status: string }> {
    if (this.hasActiveRunForSpec(options.specPath)) {
      throw new Error(
        `An active run already exists for spec '${options.specPath}'. ` +
          'Concurrent runs for the same spec are not allowed.',
      )
    }

    const runId = generateRunId(options.specPath)
    const runInfo = this.createRunInfo(runId, options.specPath)
    this.runningRuns.set(runId, runInfo)

    this.executionStore.saveRun(this.buildRunRecord(runInfo))
    this.emitEvent('run:started', runInfo)
    this.appendLog(
      runInfo,
      'info',
      'orchestrator',
      `Run started for spec: ${options.specPath}`,
    )

    // Create worktree (Req 19.1)
    try {
      const specName = options.specPath.split('/').pop() ?? 'unknown'
      const baseBranch = options.branchName ?? 'main'
      const worktreeInfo = await this.worktreeManager.create(
        specName,
        baseBranch,
      )
      runInfo.worktreePath = worktreeInfo.path
      runInfo.branchName = worktreeInfo.branch
      // WorktreeManager uses its own runId format (specName-timestamp)
      runInfo.worktreeRunId = worktreeInfo.runId
    } catch (error) {
      return this.failRun(
        runInfo,
        `Worktree creation failed: ${errorMessage(error)}`,
      )
    }

    runInfo.stateMachine.start()

    // Write execution log entry and update spec status
    const specDir = this.getSpecDirectoryPath(options.specPath)
    if (specDir) {
      await this.specWriter.writeRunStarted(
        specDir,
        runId,
        runInfo.worktreePath ?? 'unknown',
      )
    }

    try {
      await this.executePipeline(runInfo)
    } catch (error) {
      return this.failRun(
        runInfo,
        `Pipeline execution failed: ${errorMessage(error)}`,
      )
    }

    // Check for queued spec update after completion (Req 2.5)
    this.processQueuedSpecUpdate(options.specPath)

    return { runId, status: runInfo.status }
  }

  getRunStatus(runId: string): RunStatusResponse {
    const runInfo = this.runningRuns.get(runId)
    if (!runInfo) {
      throw new Error(`Run '${runId}' not found`)
    }

    const cost = this.costTracker.getRunCost(runId)
    return {
      runId: runInfo.runId,
      specPath: runInfo.specPath,
      status: runInfo.status,
      currentPhase: runInfo.currentPhase,
      elapsedMs: Date.now() - runInfo.startTime,
      cost: cost?.totalCost ?? 0,
      phaseResults: runInfo.phaseResults,
    }
  }

  listActiveRuns(): Array<{ runId: string; specPath: string; status: string }> {
    return Array.from(this.runningRuns.values())
      .filter((run) => !isTerminal(run.status))
      .map((run) => ({
        runId: run.runId,
        specPath: run.specPath,
        status: run.status,
      }))
  }

  // ---------------------------------------------------------------------------
  // Public API — Task 13.2: Workflow control
  // ---------------------------------------------------------------------------

  /** Pause a running execution. Current phase completes, then halts (Req 18.1). */
  pauseRun(runId: string): { runId: string; status: string } {
    const runInfo = this.requireRun(runId)
    if (runInfo.status !== 'running') {
      throw new Error(
        `Cannot pause run '${runId}' in status '${runInfo.status}'`,
      )
    }

    runInfo.pauseRequested = true
    this.appendLog(
      runInfo,
      'info',
      'orchestrator',
      'Pause requested — will halt after current phase',
    )
    return { runId, status: runInfo.status }
  }

  /** Resume a paused execution from the next pending phase (Req 18.2). */
  async resumeRun(runId: string): Promise<{ runId: string; status: string }> {
    const runInfo = this.requireRun(runId)
    if (runInfo.status !== 'paused') {
      throw new Error(
        `Cannot resume run '${runId}' — not paused (status: '${runInfo.status}')`,
      )
    }

    runInfo.pauseRequested = false
    runInfo.status = 'running'
    this.executionStore.updateRunStatus(runId, 'running')
    runInfo.stateMachine.resume()
    this.emitEvent('run:resumed', runInfo)
    this.appendLog(runInfo, 'info', 'orchestrator', 'Run resumed')

    const nextPhase = this.getNextPhaseAfter(runInfo.currentPhase)
    if (nextPhase) {
      try {
        await this.executePipelineFrom(runInfo, nextPhase)
      } catch (error) {
        return this.failRun(
          runInfo,
          `Pipeline failed after resume: ${errorMessage(error)}`,
        )
      }
    }

    return { runId, status: runInfo.status }
  }

  /** Cancel a running or paused execution. Preserves worktree (Req 18.3, 19.4). */
  cancelRun(runId: string): { runId: string; status: string } {
    const runInfo = this.requireRun(runId)
    if (isTerminal(runInfo.status)) {
      throw new Error(
        `Cannot cancel run '${runId}' in terminal status '${runInfo.status}'`,
      )
    }

    runInfo.cancelRequested = true
    runInfo.pauseRequested = false
    runInfo.status = 'cancelled'
    this.executionStore.updateRunStatus(runId, 'cancelled')
    runInfo.stateMachine.cancel()

    // Write cancelled status to spec directory
    const specDir = this.getSpecDirectoryPath(runInfo.specPath)
    if (specDir) {
      const cost = this.costTracker.getRunCost(runInfo.runId)
      this.specWriter
        .writeRunCompleted(specDir, runInfo.runId, 'cancelled', cost?.totalCost)
        .catch((error: unknown) => {
          this.emitEvent('run:failed', runInfo, {
            error: `Failed to write spec status on cancel: ${errorMessage(error)}`,
          })
        })
    }

    // Abort the active phase's agent (Req 13.5)
    runInfo.phaseAbortController?.abort()

    // Retain worktree for manual inspection (Req 19.4)
    this.retainWorktree(runInfo)

    this.emitEvent('run:cancelled', runInfo)
    this.appendLog(
      runInfo,
      'info',
      'orchestrator',
      `Run cancelled — worktree preserved at: ${runInfo.worktreePath ?? 'unknown'}`,
    )

    return { runId, status: 'cancelled' }
  }

  /** Queue a spec re-run after the current run for that spec completes (Req 2.5). */
  queueSpecUpdate(specPath: string): void {
    this.queuedSpecUpdates.set(specPath, specPath)
  }

  /** On startup, find non-terminal runs, verify worktrees, resume or fail (Req 27.2, 27.4, 27.5). */
  async recoverInterruptedRuns(): Promise<string[]> {
    const interruptedRuns = this.executionStore.getInterruptedRuns()
    const recoveredIds: string[] = []

    for (const record of interruptedRuns) {
      try {
        await this.recoverSingleRun(record)
        recoveredIds.push(record.runId)
      } catch (error) {
        this.executionStore.updateRunStatus(record.runId, 'failed')
        this.eventBus.emit({
          type: 'run:failed',
          runId: record.runId,
          timestamp: nowISO(),
          data: { error: `Recovery failed: ${errorMessage(error)}` },
        })
      }
    }

    return recoveredIds
  }

  // ---------------------------------------------------------------------------
  // Pipeline execution
  // ---------------------------------------------------------------------------

  private async executePipeline(runInfo: RunningRunInfo): Promise<void> {
    const firstPhase = PIPELINE_PHASES[0]
    if (!firstPhase) {
      throw new Error('No phases configured')
    }
    await this.executePipelineFrom(runInfo, firstPhase)
  }

  private async executePipelineFrom(
    runInfo: RunningRunInfo,
    startPhase: PhaseName,
  ): Promise<void> {
    let phaseIdx = PIPELINE_PHASES.indexOf(startPhase)
    if (phaseIdx === -1) {
      throw new Error(`Unknown phase: ${startPhase}`)
    }

    while (phaseIdx < PIPELINE_PHASES.length) {
      const phase = PIPELINE_PHASES[phaseIdx]
      if (!phase) {
        break
      }

      if (runInfo.cancelRequested) {
        return
      }

      // Pause check — halt before next phase (Req 18.1)
      if (runInfo.pauseRequested) {
        runInfo.status = 'paused'
        this.executionStore.updateRunStatus(runInfo.runId, 'paused')
        runInfo.stateMachine.pause()
        this.emitEvent('run:paused', runInfo)
        this.appendLog(
          runInfo,
          'info',
          'orchestrator',
          `Paused before phase '${phase}'`,
        )
        return
      }

      // Cost budget check (Req 26.5, 26.6)
      if (this.isBudgetExceeded(runInfo.runId)) {
        runInfo.status = 'failed'
        this.executionStore.updateRunStatus(runInfo.runId, 'failed')
        // Preserve worktree on budget exceeded (Req 26.6)
        this.retainWorktree(runInfo)
        this.emitEvent('run:budget_exceeded', runInfo)
        this.appendLog(
          runInfo,
          'error',
          'orchestrator',
          `Cost budget exceeded — halting pipeline. Worktree preserved at: ${runInfo.worktreePath ?? 'unknown'}`,
        )

        // Write budget exceeded status to spec directory (Req 2.4)
        const budgetSpecDir = this.getSpecDirectoryPath(runInfo.specPath)
        if (budgetSpecDir) {
          const cost = this.costTracker.getRunCost(runInfo.runId)
          await this.specWriter.writeRunCompleted(
            budgetSpecDir,
            runInfo.runId,
            'failed',
            cost?.totalCost,
            'Cost budget exceeded',
          )
        }

        return
      }

      runInfo.currentPhase = phase
      runInfo.lastUpdateTime = Date.now()

      // Write phase started log
      const specDir = this.getSpecDirectoryPath(runInfo.specPath)
      if (specDir) {
        await this.specWriter.appendExecutionLog(specDir, {
          timestamp: nowISO(),
          level: 'info',
          source: 'orchestrator',
          message: `Phase ${phase} started`,
          phase,
          runId: runInfo.runId,
        })
      }

      const phaseResult = await this.executePhase(runInfo, phase)

      const resultRecord: PhaseResultRecord = {
        ...phaseResult,
        runId: runInfo.runId,
        sequence: runInfo.phaseSequence++,
      }
      runInfo.phaseResults.push(resultRecord)
      this.executionStore.appendPhaseResult(runInfo.runId, resultRecord)

      if (phaseResult.output) {
        runInfo.phaseOutputs[phase] = phaseResult.output
      }

      // Timestamped log on phase transition (Req 3.1)
      this.appendLog(
        runInfo,
        phaseResult.status === 'success' ? 'info' : 'error',
        'orchestrator',
        `Phase '${phase}' ${phaseResult.status} (${phaseResult.duration ?? 0}ms)`,
      )

      // Write spec status update for phase completion
      if (specDir) {
        await this.specWriter.writePhaseTransition(
          specDir,
          runInfo.runId,
          phase,
          phaseResult.status === 'success' ? 'completed' : 'failed',
          phaseResult.duration,
          phaseResult.error ? phaseResult.error.message : undefined,
        )
      }

      // Write-ahead checkpoint (Req 27.1, 27.3)
      this.checkpointRun(runInfo)

      // Persist updated run record with current phase (Req 3.2)
      this.executionStore.saveRun(this.buildRunRecord(runInfo))

      const transition = runInfo.stateMachine.transition(phaseResult)

      // Terminal failure — pipeline halts (Req 6.3)
      if (transition.trigger === 'failure' && transition.to === undefined) {
        this.failRun(runInfo, `Pipeline failed at phase '${phase}'`)
        return
      }

      // Terminal success — pipeline complete
      if (transition.trigger === 'success' && transition.to === undefined) {
        runInfo.status = 'completed'
        this.executionStore.updateRunStatus(runInfo.runId, 'completed')
        this.emitEvent('run:completed', runInfo)
        this.appendLog(
          runInfo,
          'info',
          'orchestrator',
          'Pipeline completed successfully',
        )
        // Write final status update
        if (specDir) {
          const cost = this.costTracker.getRunCost(runInfo.runId)
          await this.specWriter.writeRunCompleted(
            specDir,
            runInfo.runId,
            'completed',
            cost?.totalCost,
          )
        }

        return
      }

      // Retry — re-execute the same phase (Req 6.3 via state machine)
      if (transition.trigger === 'retry') {
        this.appendLog(
          runInfo,
          'info',
          'orchestrator',
          `Retrying phase '${phase}'`,
        )
        // Don't increment phaseIdx — loop will re-execute same phase
        continue
      }

      // Loopback — jump back to implementation phase (Req 6.3 via state machine)
      if (transition.trigger === 'loopback' && transition.to) {
        const loopbackIdx = PIPELINE_PHASES.indexOf(transition.to)
        if (loopbackIdx === -1) {
          throw new Error(
            `State machine returned loopback to unknown phase '${transition.to}'`,
          )
        }
        this.appendLog(
          runInfo,
          'info',
          'orchestrator',
          `Looping back from '${phase}' to '${transition.to}'`,
        )
        phaseIdx = loopbackIdx
        continue
      }

      // Skip — advance to next phase (non-required phase failed)
      if (transition.trigger === 'skip' && transition.to) {
        const skipIdx = PIPELINE_PHASES.indexOf(transition.to)
        if (skipIdx === -1) {
          throw new Error(
            `State machine returned skip to unknown phase '${transition.to}'`,
          )
        }
        this.appendLog(
          runInfo,
          'info',
          'orchestrator',
          `Skipping from '${phase}' to '${transition.to}'`,
        )
        phaseIdx = skipIdx
        continue
      }

      // Normal success — advance to next phase
      phaseIdx++
    }
  }

  /**
   * Execute a single phase with timeout enforcement (Req 16.7, 16.8).
   * Uses AbortController pattern to prevent timer leaks.
   */
  private async executePhase(
    runInfo: RunningRunInfo,
    phase: PhaseName,
  ): Promise<PhaseResult> {
    const startedAt = nowISO()

    const agent = this.agentRegistry.getAgentForPhase(phase)
    if (!agent) {
      return this.buildPhaseFailure(
        phase,
        startedAt,
        `No agent registered for phase '${phase}'`,
      )
    }

    const agentMeta = this.agentRegistry
      .listRegistered()
      .find((m) => m.phase === phase)
    const agentName = agentMeta?.name ?? phase

    this.eventBus.emit({
      type: 'phase:started',
      runId: runInfo.runId,
      timestamp: startedAt,
      phase,
      agent: agentName,
    })

    const slot = await this.concurrencyManager.acquire(runInfo.runId, phase)

    try {
      // Create a fresh AbortController for this phase (Req 13.5)
      const phaseAbortController = new AbortController()
      runInfo.phaseAbortController = phaseAbortController

      const context = this.buildAgentContext(runInfo)
      const timeoutMs = this.getPhaseTimeoutMs(phase)

      // Race agent execution against timeout, with proper cleanup
      const agentResult = await this.raceWithTimeout(
        agent.execute(context),
        timeoutMs,
        phase,
      )

      // Track cost
      if (agentResult.tokensUsed && agentResult.tokensUsed > 0) {
        const backendName = this.backendRegistry.getDefaultBackendName()
        const backendConfig = this.backendRegistry.getConfig(backendName)
        const costRate =
          backendConfig?.costPer1000Tokens ?? DEFAULT_COST_PER_1000_TOKENS
        this.costTracker.recordInvocation(
          runInfo.runId,
          backendName,
          agentResult.tokensUsed,
          costRate,
        )
      }

      const completedAt = nowISO()
      const duration = Date.now() - new Date(startedAt).getTime()

      if (agentResult.success) {
        this.eventBus.emit({
          type: 'phase:completed',
          runId: runInfo.runId,
          timestamp: completedAt,
          phase,
          agent: agentName,
          data: { duration },
        })
        return {
          phase,
          status: 'success',
          output: agentResult.output,
          startedAt,
          completedAt,
          duration,
        }
      }

      this.eventBus.emit({
        type: 'phase:failed',
        runId: runInfo.runId,
        timestamp: completedAt,
        phase,
        agent: agentName,
        data: { error: agentResult.error?.message },
      })

      return {
        phase,
        status: 'failure',
        error: agentResult.error ?? {
          message: 'Agent returned unsuccessful result',
          retryable: true,
        },
        startedAt,
        completedAt,
        duration,
      }
    } catch (error) {
      const completedAt = nowISO()
      const duration = Date.now() - new Date(startedAt).getTime()
      const isTimeout = errorMessage(error).includes('timed out')

      this.eventBus.emit({
        type: isTimeout ? 'phase:timeout' : 'phase:failed',
        runId: runInfo.runId,
        timestamp: completedAt,
        phase,
        agent: agentName,
        data: { error: errorMessage(error) },
      })

      return {
        phase,
        status: isTimeout ? 'timeout' : 'failure',
        error: { message: errorMessage(error), retryable: !isTimeout },
        startedAt,
        completedAt,
        duration,
      }
    } finally {
      runInfo.phaseAbortController = undefined
      slot.release()
    }
  }

  // ---------------------------------------------------------------------------
  // Recovery
  // ---------------------------------------------------------------------------

  private async recoverSingleRun(record: ExecutionRunRecord): Promise<void> {
    const runId = record.runId

    if (!record.worktreePath) {
      this.executionStore.updateRunStatus(runId, 'failed')
      return
    }

    // Load worktrees from disk so isConsistent/exists can find them
    await this.worktreeManager.loadExistingWorktrees()

    // WorktreeManager indexes by its own runId format, which is stored in the
    // worktree directory name. Extract it from the worktreePath.
    const worktreeRunId = record.worktreePath.split('/').pop()
    if (!worktreeRunId) {
      this.executionStore.updateRunStatus(runId, 'failed')
      return
    }

    if (!this.worktreeManager.exists(worktreeRunId)) {
      // Worktree missing (Req 27.5)
      this.executionStore.updateRunStatus(runId, 'failed')
      return
    }

    const isConsistent = await this.worktreeManager.isConsistent(worktreeRunId)
    if (!isConsistent) {
      // Worktree corrupted (Req 27.5)
      this.executionStore.updateRunStatus(runId, 'failed')
      return
    }

    const phaseResults = this.executionStore.getPhaseResults(runId)
    const lastResult =
      phaseResults.length > 0
        ? phaseResults[phaseResults.length - 1]
        : undefined
    const lastPhase = lastResult?.phase
    const nextPhase = this.getNextPhaseAfter(lastPhase)

    if (!nextPhase) {
      this.executionStore.updateRunStatus(runId, 'completed')
      return
    }

    const runInfo = this.createRunInfo(runId, record.specPath)
    runInfo.worktreePath = record.worktreePath
    runInfo.worktreeRunId = worktreeRunId
    runInfo.phaseResults = phaseResults
    runInfo.phaseOutputs = this.extractPhaseOutputs(phaseResults)
    runInfo.phaseSequence = phaseResults.length
    runInfo.currentPhase = lastPhase
    runInfo.startTime = new Date(record.startedAt).getTime()

    this.runningRuns.set(runId, runInfo)
    runInfo.stateMachine.start()
    this.emitEvent('run:resumed', runInfo, { recovered: true })
    this.appendLog(
      runInfo,
      'info',
      'orchestrator',
      `Recovered — resuming at phase '${nextPhase}'`,
    )

    await this.executePipelineFrom(runInfo, nextPhase)
  }

  // ---------------------------------------------------------------------------
  // Context building
  // ---------------------------------------------------------------------------

  private buildAgentContext(runInfo: RunningRunInfo): AgentContext {
    const backends: Record<
      string,
      import('@/config/schema').ExecutorBackendConfig
    > = {}
    for (const name of this.backendRegistry.listBackends()) {
      const cfg = this.backendRegistry.getConfig(name)
      if (cfg) {
        backends[name] = cfg
      }
    }

    return {
      runId: runInfo.runId,
      spec: this.buildEmptySpec(runInfo.specPath),
      steering: this.buildEmptySteering(),
      phaseOutputs: { ...runInfo.phaseOutputs },
      config: this.config,
      worktreePath: runInfo.worktreePath,
      backends,
      abortSignal: runInfo.phaseAbortController?.signal,
    }
  }

  private buildEmptySpec(specPath: string): ParsedSpec {
    return {
      featureName: specPath.split('/').pop() ?? 'unknown',
      specPath,
      missingFiles: [],
    }
  }

  private buildEmptySteering(): SteeringFiles {
    return { hooks: {} }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private createRunInfo(runId: string, specPath: string): RunningRunInfo {
    const now = Date.now()
    return {
      runId,
      specPath,
      status: 'running',
      startTime: now,
      lastUpdateTime: now,
      stateMachine: new StateMachine(1000, this.eventBus, undefined, runId),
      phaseResults: [],
      phaseOutputs: {},
      phaseSequence: 0,
      logs: [],
      pauseRequested: false,
      cancelRequested: false,
    }
  }

  private requireRun(runId: string): RunningRunInfo {
    const runInfo = this.runningRuns.get(runId)
    if (!runInfo) {
      throw new Error(`Run '${runId}' not found`)
    }
    return runInfo
  }

  private hasActiveRunForSpec(specPath: string): boolean {
    for (const run of this.runningRuns.values()) {
      if (run.specPath === specPath && !isTerminal(run.status)) {
        return true
      }
    }
    return false
  }

  private failRun(
    runInfo: RunningRunInfo,
    message: string,
  ): { runId: string; status: string } {
    // Write run failed log and status
    const specDir = this.getSpecDirectoryPath(runInfo.specPath)
    if (specDir) {
      const cost = this.costTracker.getRunCost(runInfo.runId)
      this.specWriter
        .writeRunCompleted(
          specDir,
          runInfo.runId,
          'failed',
          cost?.totalCost,
          message,
        )
        .catch((error: unknown) => {
          this.emitEvent('run:failed', runInfo, {
            error: `Failed to write spec status on failure: ${errorMessage(error)}`,
          })
        })
    }

    runInfo.status = 'failed'
    this.executionStore.updateRunStatus(runInfo.runId, 'failed')
    // Preserve worktree on failure (Req 16.6, 19.4)
    this.retainWorktree(runInfo)
    this.emitEvent('run:failed', runInfo, { error: message })
    this.appendLog(runInfo, 'error', 'orchestrator', message)
    return { runId: runInfo.runId, status: 'failed' }
  }

  /** Mark the worktree as retained so it won't be auto-cleaned (Req 19.4) */
  private retainWorktree(runInfo: RunningRunInfo): void {
    if (!runInfo.worktreeRunId) {
      return
    }
    try {
      this.worktreeManager.retain(runInfo.worktreeRunId)
    } catch {
      // Worktree may already be gone — log but don't fail
      this.appendLog(
        runInfo,
        'warn',
        'orchestrator',
        'Failed to retain worktree — it may have been removed',
      )
    }
  }

  private isBudgetExceeded(runId: string): boolean {
    const budget = this.config.costBudgetPerRun
    if (budget === undefined) {
      return false
    }
    return this.costTracker.checkBudget(runId, budget)
  }

  private getPhaseTimeoutMs(phase: PhaseName): number {
    const seconds =
      this.config.phaseTimeouts[phase] ??
      this.config.defaultPhaseTimeout ??
      DEFAULT_PHASE_TIMEOUT_SECONDS
    return seconds * MS_PER_SECOND
  }

  /**
   * Race a promise against a timeout, clearing the timer on completion to prevent leaks.
   * The timer is always cleaned up regardless of which side wins.
   */
  private raceWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    phase: PhaseName,
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined

    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(new Error(`Phase '${phase}' timed out after ${timeoutMs}ms`)),
        timeoutMs,
      )
    })

    return Promise.race([promise, timeoutPromise]).finally(() => {
      if (timer !== undefined) {
        clearTimeout(timer)
      }
    })
  }

  private getNextPhaseAfter(
    currentPhase: PhaseName | undefined,
  ): PhaseName | undefined {
    if (!currentPhase) {
      return PIPELINE_PHASES[0]
    }
    const idx = PIPELINE_PHASES.indexOf(currentPhase)
    if (idx === -1 || idx >= PIPELINE_PHASES.length - 1) {
      return undefined
    }
    return PIPELINE_PHASES[idx + 1]
  }

  /**
   * Get the spec directory path (.kiro/specs/[feature-name]) for a given spec path
   */
  private getSpecDirectoryPath(specPath: string): string | null {
    const specName = specPath.split('/').pop()
    if (!specName) {
      return null
    }
    return `.kiro/specs/${specName}`
  }

  private extractPhaseOutputs(
    results: PhaseResultRecord[],
  ): Partial<Record<PhaseName, PhaseOutput>> {
    const outputs: Partial<Record<PhaseName, PhaseOutput>> = {}
    for (const result of results) {
      if (result.status === 'success' && result.output) {
        outputs[result.phase] = result.output
      }
    }
    return outputs
  }

  private processQueuedSpecUpdate(specPath: string): void {
    if (!this.queuedSpecUpdates.has(specPath)) {
      return
    }
    this.queuedSpecUpdates.delete(specPath)

    // Fire-and-forget but catch errors to prevent unhandled rejections
    this.startRun({ specPath }).catch((error: unknown) => {
      this.eventBus.emit({
        type: 'run:failed',
        runId: 'queued-rerun',
        timestamp: nowISO(),
        data: {
          error: `Queued re-run failed: ${errorMessage(error)}`,
          specPath,
        },
      })
    })
  }

  private checkpointRun(runInfo: RunningRunInfo): void {
    try {
      this.checkpointManager.saveCheckpoint(
        runInfo.runId,
        runInfo.currentPhase ?? 'intake',
        {
          run: this.buildRunRecord(runInfo),
          phaseResults: runInfo.phaseResults,
        },
      )
    } catch {
      this.eventBus.emit({
        type: 'agent:error',
        runId: runInfo.runId,
        timestamp: nowISO(),
        data: { message: 'Checkpoint save failed' },
      })
    }
  }

  private appendLog(
    runInfo: RunningRunInfo,
    level: LogEntry['level'],
    source: string,
    message: string,
  ): void {
    runInfo.logs.push({ timestamp: nowISO(), level, source, message })
  }

  private buildRunRecord(runInfo: RunningRunInfo): ExecutionRunRecord {
    const cost = this.costTracker.getRunCost(runInfo.runId)
    return {
      runId: runInfo.runId,
      specPath: runInfo.specPath,
      status: runInfo.status,
      currentPhase: runInfo.currentPhase,
      phases: PIPELINE_PHASES.slice(),
      startedAt: new Date(runInfo.startTime).toISOString(),
      worktreePath: runInfo.worktreePath,
      cost: cost?.totalCost ?? 0,
      phaseResults: runInfo.phaseResults,
      logs: runInfo.logs,
    }
  }

  private buildPhaseFailure(
    phase: PhaseName,
    startedAt: string,
    message: string,
  ): PhaseResult {
    return {
      phase,
      status: 'failure',
      error: { message, retryable: false },
      startedAt,
      completedAt: nowISO(),
      duration: Date.now() - new Date(startedAt).getTime(),
    }
  }

  private emitEvent(
    type: EventType,
    runInfo: RunningRunInfo,
    data?: Record<string, unknown>,
  ): void {
    this.eventBus.emit({
      type,
      runId: runInfo.runId,
      timestamp: nowISO(),
      phase: runInfo.currentPhase,
      data,
    })
  }
}
