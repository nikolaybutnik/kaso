import {
  PhaseName,
  ExecutionEvent,
  PhaseResult,
  PhaseOutput,
  EventType,
} from '@/core/types'
import { EventBus } from '@/core/event-bus'

/**
 * Status of the overall pipeline (mirrors RunStatus from core/types)
 */
export type PipelineStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

/**
 * Trigger for a phase transition
 */
export type TransitionTrigger =
  | 'success'
  | 'failure'
  | 'retry'
  | 'loopback'
  | 'pause'
  | 'resume'
  | 'cancel'
  | 'skip'

/**
 * Phase transition record (richer than core PhaseTransition to support all trigger types)
 */
export interface SMTransition {
  from?: PhaseName
  to?: PhaseName
  timestamp: string
  trigger: TransitionTrigger
  reason?: string
  data?: Record<string, unknown>
}

/**
 * Phase configuration for error handling policy
 */
export interface PhaseConfig {
  name: PhaseName
  maxRetries: number
  loopBackAllowed: boolean
  skipOnFailure: boolean
  required: boolean
}

/** Map from transition triggers to valid EventType values */
const TRIGGER_EVENT_MAP: Partial<Record<TransitionTrigger, EventType>> = {
  success: 'phase:completed',
  failure: 'phase:failed',
  pause: 'run:paused',
  resume: 'run:resumed',
  cancel: 'run:cancelled',
}

/** Map from PhaseResult.status to EventType for result-specific events */
const RESULT_STATUS_EVENT_MAP: Partial<
  Record<PhaseResult['status'], EventType>
> = {
  timeout: 'phase:timeout',
}

/**
 * State machine for managing phase transitions in the pipeline.
 * Enforces sequential order with support for retry, loop-back, pause/resume, cancel.
 */
export class StateMachine {
  private currentPhase: PhaseName | undefined
  private pipelineStatus: PipelineStatus = 'pending'
  private transitionHistory: SMTransition[] = []
  private readonly maxHistorySize: number
  private readonly phaseConfigs = new Map<PhaseName, PhaseConfig>()
  private readonly eventBus?: EventBus
  private readonly runId: string
  private pauseRequested = false
  private cancelRequested = false

  private static readonly BUILT_IN_PHASES: PhaseName[] = [
    'intake',
    'validation',
    'architecture-analysis',
    'implementation',
    'architecture-review',
    'test-verification',
    'ui-validation',
    'review-delivery',
  ]

  constructor(
    maxHistorySize: number = 1000,
    eventBus?: EventBus,
    customPhases?: PhaseName[],
    runId: string = 'state-machine',
  ) {
    this.maxHistorySize = maxHistorySize
    this.eventBus = eventBus
    this.runId = runId

    const phases = customPhases ?? StateMachine.BUILT_IN_PHASES
    for (const phase of phases) {
      this.phaseConfigs.set(phase, StateMachine.defaultPhaseConfig(phase))
    }
  }

  private static defaultPhaseConfig(phase: PhaseName): PhaseConfig {
    const isCustom = phase.startsWith('custom-')
    return {
      name: phase,
      maxRetries: phase === 'implementation' ? 2 : 1,
      loopBackAllowed:
        phase === 'test-verification' || phase === 'architecture-review',
      skipOnFailure: false,
      required: !isCustom || phase.includes('required'),
    }
  }

  setPhaseConfig(phase: PhaseName, config: Partial<PhaseConfig>): void {
    const current = this.requirePhaseConfig(phase)
    this.phaseConfigs.set(phase, { ...current, ...config })
  }

  getCurrentPhase(): PhaseName | undefined {
    return this.currentPhase
  }

  getStatus(): PipelineStatus {
    return this.pipelineStatus
  }

  isRunning(): boolean {
    return this.pipelineStatus === 'running'
  }

  isPaused(): boolean {
    return this.pipelineStatus === 'paused'
  }

  isCancelled(): boolean {
    return this.pipelineStatus === 'cancelled'
  }

  start(): SMTransition {
    if (this.pipelineStatus !== 'pending') {
      throw new Error(
        `Cannot start pipeline from status: ${this.pipelineStatus}`,
      )
    }
    return this.recordTransition(
      this.getFirstPhase(),
      'resume',
      'Starting pipeline',
    )
  }

  transition(result: PhaseResult): SMTransition {
    if (this.cancelRequested) return this.cancel()
    if (this.pauseRequested) return this.doPause()

    if (!this.currentPhase) {
      throw new Error('No current phase to transition from')
    }

    // Emit timeout-specific event before handling as failure
    const resultEvent = RESULT_STATUS_EVENT_MAP[result.status]
    if (resultEvent) {
      this.emitEvent(resultEvent, this.currentPhase, { result })
    }

    const config = this.requirePhaseConfig(this.currentPhase)

    if (result.status === 'failure' || result.status === 'timeout') {
      return this.handleFailure(result, config)
    }

    if (result.status === 'success') {
      const nextPhase = this.getNextPhase(this.currentPhase)
      return nextPhase
        ? this.recordTransition(nextPhase, 'success', result.output)
        : this.complete()
    }

    if (result.status === 'cancelled') {
      return this.cancel()
    }

    throw new Error(`Unhandled phase result status: ${result.status}`)
  }

  pause(): SMTransition {
    if (this.pipelineStatus !== 'running') {
      throw new Error(
        `Cannot pause pipeline from status: ${this.pipelineStatus}`,
      )
    }
    this.pauseRequested = true
    return this.recordTransition(this.currentPhase, 'pause', 'Pipeline paused')
  }

  resume(): SMTransition {
    if (this.pipelineStatus !== 'paused') {
      throw new Error('Pipeline is not paused')
    }
    this.pauseRequested = false
    return this.recordTransition(
      this.currentPhase,
      'resume',
      'Pipeline resumed',
    )
  }

  cancel(): SMTransition {
    this.cancelRequested = true
    return this.recordTransition(undefined, 'cancel', 'Pipeline cancelled')
  }

  getPhaseConfig(phase: PhaseName): PhaseConfig {
    return this.requirePhaseConfig(phase)
  }

  getHistory(): ReadonlyArray<SMTransition> {
    return this.transitionHistory
  }

  getRecentTransitions(limit: number = 10): ReadonlyArray<SMTransition> {
    const startIndex = Math.max(0, this.transitionHistory.length - limit)
    return this.transitionHistory.slice(startIndex)
  }

  clearHistory(): void {
    this.transitionHistory = []
  }

  hasCompletedPhase(phase: PhaseName): boolean {
    return this.transitionHistory.some(
      (t) => t.from === phase && t.trigger === 'success',
    )
  }

  getProgress(): number {
    const phases = Array.from(this.phaseConfigs.keys())
    if (phases.length === 0) return 0

    const completedCount = phases.filter((p) =>
      this.hasCompletedPhase(p),
    ).length
    return completedCount / phases.length
  }

  getPhaseCount(): number {
    return this.phaseConfigs.size
  }

  canTransitionTo(phase: PhaseName): boolean {
    if (!this.currentPhase) {
      return phase === this.getFirstPhase()
    }
    const nextPhase = this.getNextPhase(this.currentPhase)
    const canLoop =
      this.canLoopBack() && phase === ('implementation' as PhaseName)
    return phase === nextPhase || canLoop
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private handleFailure(
    result: PhaseResult,
    config: PhaseConfig,
  ): SMTransition {
    const retryCount = this.getRetryCount(this.currentPhase!)
    const canRetry = result.error?.retryable !== false
    if (canRetry && retryCount < config.maxRetries) {
      return this.retry()
    }

    if (config.loopBackAllowed && this.canLoopBack()) {
      return this.loopBack()
    }
    if (config.skipOnFailure) {
      return this.skipToNext()
    }
    return this.halt(result)
  }

  private retry(): SMTransition {
    return this.recordTransition(
      this.currentPhase,
      'retry',
      `Retrying phase ${this.currentPhase}`,
    )
  }

  private loopBack(): SMTransition {
    return this.recordTransition(
      'implementation' as PhaseName,
      'loopback',
      'Looping back to implementation',
    )
  }

  private canLoopBack(): boolean {
    if (!this.currentPhase) return false
    const config = this.requirePhaseConfig(this.currentPhase)
    if (!config.loopBackAllowed) return false

    const phases = Array.from(this.phaseConfigs.keys())
    const implIndex = phases.indexOf('implementation' as PhaseName)
    const currentIndex = phases.indexOf(this.currentPhase)
    return currentIndex > implIndex
  }

  private skipToNext(): SMTransition {
    if (!this.currentPhase) {
      throw new Error('No current phase to skip from')
    }
    const nextPhase = this.getNextPhase(this.currentPhase)
    return nextPhase
      ? this.recordTransition(
          nextPhase,
          'skip',
          `Skipping ${this.currentPhase}`,
        )
      : this.complete()
  }

  private halt(result: PhaseResult): SMTransition {
    return this.recordTransition(undefined, 'failure', result.error?.message)
  }

  private complete(): SMTransition {
    return this.recordTransition(
      undefined,
      'success',
      'Pipeline completed successfully',
    )
  }

  /** Internal alias so pause() stays public while transition() can call it too */
  private doPause(): SMTransition {
    return this.pause()
  }

  private getFirstPhase(): PhaseName {
    const phases = Array.from(this.phaseConfigs.keys())
    const first = phases[0]
    if (!first) {
      throw new Error('Pipeline has no phases configured')
    }
    return first
  }

  private getNextPhase(current: PhaseName): PhaseName | undefined {
    const phases = Array.from(this.phaseConfigs.keys())
    const idx = phases.indexOf(current)
    if (idx === -1) throw new Error(`Unknown phase: ${current}`)
    return phases[idx + 1]
  }

  private requirePhaseConfig(phase: PhaseName): PhaseConfig {
    const config = this.phaseConfigs.get(phase)
    if (!config) {
      throw new Error(`No configuration found for phase: ${phase}`)
    }
    return config
  }

  private getRetryCount(phase: PhaseName): number {
    return this.transitionHistory.filter(
      (t) => t.to === phase && t.trigger === 'retry',
    ).length
  }

  private recordTransition(
    targetPhase: PhaseName | undefined,
    trigger: TransitionTrigger,
    reason?: string | PhaseOutput,
  ): SMTransition {
    const transition: SMTransition = {
      from: this.currentPhase,
      to: targetPhase,
      timestamp: new Date().toISOString(),
      trigger,
      reason: typeof reason === 'string' ? reason : undefined,
      data:
        typeof reason === 'object'
          ? (reason as Record<string, unknown>)
          : undefined,
    }

    if (targetPhase) {
      this.currentPhase = targetPhase
    }

    this.updatePipelineStatus(trigger, targetPhase)

    this.transitionHistory.push(transition)
    if (this.transitionHistory.length > this.maxHistorySize) {
      this.transitionHistory.shift()
    }

    const eventType = TRIGGER_EVENT_MAP[trigger]
    if (eventType) {
      this.emitEvent(eventType, this.currentPhase, {
        transition,
        pipelineStatus: this.pipelineStatus,
      })
    }

    // Emit phase:started when entering a new phase (not for retries/pause/resume staying on same phase)
    const isNewPhaseEntry =
      targetPhase !== undefined &&
      trigger !== 'retry' &&
      trigger !== 'pause' &&
      targetPhase !== transition.from
    if (isNewPhaseEntry) {
      this.emitEvent('phase:started', targetPhase, {
        pipelineStatus: this.pipelineStatus,
      })
    }

    return transition
  }

  private updatePipelineStatus(
    trigger: TransitionTrigger,
    targetPhase: PhaseName | undefined,
  ): void {
    if (this.pipelineStatus === 'pending' && trigger === 'resume') {
      this.pipelineStatus = 'running'
      this.emitEvent('run:started', targetPhase)
      return
    }
    if (trigger === 'pause') {
      this.pipelineStatus = 'paused'
      return
    }
    if (trigger === 'failure' && targetPhase === undefined) {
      this.pipelineStatus = 'failed'
      this.emitEvent('run:failed', this.currentPhase)
      return
    }
    if (trigger === 'success' && targetPhase === undefined) {
      this.pipelineStatus = 'completed'
      this.emitEvent('run:completed', this.currentPhase)
      return
    }
    if (trigger === 'cancel') {
      this.pipelineStatus = 'cancelled'
      return
    }
    if (trigger === 'resume' && this.pipelineStatus === 'paused') {
      this.pipelineStatus = 'running'
    }
  }

  private emitEvent(
    type: EventType,
    phase: PhaseName | undefined,
    data?: Record<string, unknown>,
  ): void {
    if (!this.eventBus) return

    const event: ExecutionEvent = {
      type,
      runId: this.runId,
      timestamp: new Date().toISOString(),
      phase,
      data,
    }

    this.eventBus.emit(event)
  }
}
