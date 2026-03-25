/**
 * Review Council Agent (Phase 8 — Review & Delivery)
 * Configurable multi-perspective code review with consensus logic.
 *
 * Responsibilities:
 * - Spawn configurable reviewer instances from `reviewers` array or legacy `perspectives`
 * - Support custom review perspectives (e.g., accessibility, compliance)
 * - Per-reviewer backend assignment with fallback chain: reviewer.backend → phaseBackends['review-delivery'] → defaultBackend
 * - Generalized consensus: all approve → passed, ≥ Math.floor(N*2/3) → passed-with-warnings, else rejected
 * - Enforce maxReviewRounds cap (default 2) and reviewBudgetUsd cost cap
 * - Support parallel vs sequential execution toggle
 * - Emit agent:backend-selected events for per-reviewer backend overrides
 * - Heuristic fallback for custom roles without backend
 *
 * Requirements: 4.2–4.4, 5.1–5.2, 6.1–6.6, 7.1–7.9, 8.1–8.4, 9.1–9.3, 11.3, 15.1–15.5, 29.1–29.3
 */

import type {
  AgentContext,
  AgentResult,
  ReviewCouncilResult,
  TestReport,
  ArchitectureReview,
  ImplementationResult,
  BackendProgressEvent,
  PhaseOutput,
} from '@/core/types'
import type { Agent } from './agent-interface'
import type { ExecutorBackend } from '@/backends/backend-adapter'
import type { BackendRegistry } from '@/backends/backend-registry'
import type { ReviewCouncilConfig, ReviewerConfig } from '@/config/schema'
import { EventBus } from '@/core/event-bus'

/** Estimated duration for review council agent in milliseconds */
const ESTIMATED_DURATION_MS = 30_000

/** Default cost per review round in USD (for estimation) */
const DEFAULT_COST_PER_ROUND_USD = 0.05

/**
 * Perspective types for review council
 * @deprecated Use `string` for custom perspectives. Kept for backward compatibility.
 */
export type ReviewPerspective = 'security' | 'performance' | 'maintainability'

/** Individual vote from a perspective reviewer */
export interface ReviewVote {
  perspective: string
  approved: boolean
  feedback: string
  severity: 'high' | 'medium' | 'low'
}

/** Internal result from a single perspective review */
interface PerspectiveReviewResult {
  vote: ReviewVote
  tokensUsed: number
  cost: number
}

/** Review council dependencies */
export interface ReviewCouncilDependencies {
  eventBus?: EventBus
  backendRegistry: BackendRegistry
}

/**
 * ReviewCouncilAgent — Phase 8: Multi-perspective Code Review
 *
 * Performs parallel or sequential security, performance, and maintainability
 * reviews, applies consensus logic, and enforces budget/round limits.
 */
export class ReviewCouncilAgent implements Agent {
  private readonly eventBus: EventBus
  private readonly backendRegistry: BackendRegistry

  constructor(
    deps: ReviewCouncilDependencies = {} as ReviewCouncilDependencies,
  ) {
    this.eventBus = deps.eventBus ?? new EventBus()
    this.backendRegistry = deps.backendRegistry
  }

  // ---------------------------------------------------------------------------
  // Agent interface
  // ---------------------------------------------------------------------------

  async execute(context: AgentContext): Promise<AgentResult> {
    const startTime = Date.now()
    const config = this.getReviewConfig(context)

    try {
      if (context.abortSignal?.aborted) {
        return this.abortedResult(startTime)
      }

      this.validateContext(context)

      // Gather context from previous phases
      const reviewContext = this.buildReviewContext(context)

      // Execute review rounds
      const result = await this.executeReviewRounds(
        reviewContext,
        config,
        context,
      )

      return {
        success: result.consensus !== 'rejected',
        output: result,
        duration: Date.now() - startTime,
      }
    } catch (error) {
      return {
        success: false,
        error: formatError(error),
        duration: Date.now() - startTime,
      }
    }
  }

  supportsRollback(): boolean {
    return false
  }

  estimatedDuration(): number {
    return ESTIMATED_DURATION_MS
  }

  requiredContext(): string[] {
    return [
      'phaseOutputs.implementation',
      'phaseOutputs.architecture-review',
      'phaseOutputs.test-verification',
    ]
  }

  // ---------------------------------------------------------------------------
  // Context helpers
  // ---------------------------------------------------------------------------

  private validateContext(context: AgentContext): void {
    const impl = context.phaseOutputs['implementation'] as
      | ImplementationResult
      | undefined
    if (!impl) {
      throw new Error('Missing implementation result from Phase 4')
    }
  }

  private getReviewConfig(context: AgentContext): ReviewCouncilConfig {
    return (
      context.config.reviewCouncil ?? {
        maxReviewRounds: 2,
        enableParallelReview: false,
        perspectives: ['security', 'performance', 'maintainability'],
      }
    )
  }

  /**
   * Get effective reviewers from config.
   * Uses reviewers array if present, otherwise converts perspectives to ReviewerConfig.
   */
  private getEffectiveReviewers(config: ReviewCouncilConfig): ReviewerConfig[] {
    if (config.reviewers && config.reviewers.length > 0) {
      return config.reviewers
    }
    // Legacy: convert perspectives to ReviewerConfig
    const perspectives = config.perspectives ?? [
      'security',
      'performance',
      'maintainability',
    ]
    return perspectives.map((p) => ({ role: p }))
  }

  private buildReviewContext(context: AgentContext): ReviewContext {
    const implementation = context.phaseOutputs['implementation'] as
      | ImplementationResult
      | undefined
    const architectureReview = context.phaseOutputs['architecture-review'] as
      | ArchitectureReview
      | undefined
    const testReport = context.phaseOutputs['test-verification'] as
      | TestReport
      | undefined

    return {
      modifiedFiles: implementation?.modifiedFiles ?? [],
      addedTests: implementation?.addedTests ?? [],
      architectureViolations: architectureReview?.violations ?? [],
      testPassed: testReport?.passed ?? false,
      testCoverage: testReport?.coverage ?? 0,
      spec: context.spec,
    }
  }

  private abortedResult(startTime: number): AgentResult {
    return {
      success: false,
      error: { message: 'Execution aborted', retryable: false },
      duration: Date.now() - startTime,
    }
  }

  // ---------------------------------------------------------------------------
  // Review execution
  // ---------------------------------------------------------------------------

  /**
   * Execute review rounds until consensus is reached or limits exceeded.
   * Enforces maxReviewRounds and reviewBudgetUsd caps.
   */
  private async executeReviewRounds(
    reviewContext: ReviewContext,
    config: ReviewCouncilConfig,
    agentContext: AgentContext,
  ): Promise<ReviewCouncilResult> {
    const reviewers = this.getEffectiveReviewers(config)
    const maxRounds = config.maxReviewRounds ?? 2
    const budgetUsd = config.reviewBudgetUsd
    const parallel = config.enableParallelReview ?? false

    let currentRound = 0
    let totalCost = 0
    const allVotes: ReviewVote[] = []

    while (currentRound < maxRounds) {
      if (agentContext.abortSignal?.aborted) {
        throw new Error('Execution aborted')
      }

      currentRound++
      this.emitProgress(
        agentContext.runId,
        `Starting review round ${currentRound}/${maxRounds}`,
      )

      // Check budget before starting round
      const estimatedRoundCost = this.estimateRoundCost(reviewers.length)
      if (
        budgetUsd !== undefined &&
        totalCost + estimatedRoundCost > budgetUsd
      ) {
        this.emitProgress(
          agentContext.runId,
          `Budget limit reached ($${totalCost.toFixed(2)} / $${budgetUsd}), stopping reviews`,
        )
        break
      }

      // Execute reviews for this round
      const roundResults = await this.executeRound(
        reviewContext,
        reviewers,
        parallel,
        agentContext,
        currentRound,
      )

      // Accumulate costs and votes
      for (const result of roundResults) {
        totalCost += result.cost
        allVotes.push(result.vote)
      }

      // Check if we've reached consensus (all reviewers approved)
      const roundVotes = roundResults.map((r) => r.vote)
      const allApproved = roundVotes.every((v) => v.approved)

      if (allApproved) {
        this.emitProgress(
          agentContext.runId,
          `All reviewers approved in round ${currentRound}`,
        )
        break
      }

      // If not final round, provide feedback for next round
      if (currentRound < maxRounds) {
        const rejections = roundVotes.filter((v) => !v.approved)
        this.emitProgress(
          agentContext.runId,
          `${rejections.length} reviewer(s) rejected, proceeding to round ${currentRound + 1}`,
        )
      }
    }

    // Determine final consensus
    const consensus = this.determineConsensus(allVotes)

    return {
      consensus,
      votes: allVotes,
      rounds: currentRound,
      cost: totalCost,
    }
  }

  /**
   * Execute a single round of reviews.
   * Supports parallel or sequential execution based on config.
   */
  private async executeRound(
    reviewContext: ReviewContext,
    reviewers: ReviewerConfig[],
    parallel: boolean,
    agentContext: AgentContext,
    roundNum: number,
  ): Promise<PerspectiveReviewResult[]> {
    if (parallel) {
      // Parallel execution: all reviewers review simultaneously
      this.emitProgress(
        agentContext.runId,
        `Round ${roundNum}: Executing parallel reviews`,
      )
      const results = await Promise.all(
        reviewers.map((r) =>
          this.executePerspectiveReview(r, reviewContext, agentContext),
        ),
      )
      return results
    } else {
      // Sequential execution: one reviewer at a time
      const results: PerspectiveReviewResult[] = []
      for (const reviewer of reviewers) {
        this.emitProgress(
          agentContext.runId,
          `Round ${roundNum}: Executing ${reviewer.role} review`,
        )
        const result = await this.executePerspectiveReview(
          reviewer,
          reviewContext,
          agentContext,
        )
        results.push(result)
      }
      return results
    }
  }

  /**
   * Execute a single perspective review.
   * Delegates to the executor backend if available, otherwise uses heuristic.
   */
  private async executePerspectiveReview(
    reviewer: ReviewerConfig,
    reviewContext: ReviewContext,
    agentContext: AgentContext,
  ): Promise<PerspectiveReviewResult> {
    const backend = this.resolveReviewerBackend(reviewer, agentContext)

    if (backend) {
      return this.executeBackendReview(
        backend,
        reviewer,
        reviewContext,
        agentContext,
      )
    } else {
      return this.executeHeuristicReview(reviewer.role, reviewContext)
    }
  }

  /**
   * Execute review via backend (preferred method).
   */
  private async executeBackendReview(
    backend: ExecutorBackend,
    reviewer: ReviewerConfig,
    reviewContext: ReviewContext,
    agentContext: AgentContext,
  ): Promise<PerspectiveReviewResult> {
    const perspective = reviewer.role
    const prompt = this.buildReviewPrompt(perspective, reviewContext)

    // Emit backend selection event when reviewer has explicit backend
    if (reviewer.backend) {
      this.eventBus.emit({
        type: 'agent:backend-selected',
        runId: agentContext.runId,
        timestamp: new Date().toISOString(),
        phase: 'review-delivery',
        data: {
          backend: backend.name,
          reason: 'reviewer-override',
          reviewerRole: reviewer.role,
        },
      })
    }

    let tokensUsed = 0

    // Stream progress events
    backend.onProgress((event: BackendProgressEvent) => {
      this.eventBus.emit({
        type: 'agent:progress',
        runId: agentContext.runId,
        timestamp: event.timestamp,
        phase: 'review-delivery',
        agent: `review-council-${perspective}`,
        data: { message: event.message },
      })
    })

    // Create a valid phase output structure
    const phaseOutputs: Partial<Record<'review-delivery', PhaseOutput>> = {
      'review-delivery': { prompt },
    }

    const response = await backend.execute({
      id: `${agentContext.runId}-${perspective}`,
      context: {
        ...agentContext,
        phaseOutputs: {
          ...agentContext.phaseOutputs,
          ...phaseOutputs,
        },
      },
      phase: 'review-delivery',
      streamProgress: true,
    })

    tokensUsed = response.tokensUsed ?? this.estimateTokens(prompt)

    if (!response.success || !response.output) {
      // Fallback to heuristic if backend fails
      return this.executeHeuristicReview(perspective, reviewContext)
    }

    const output = response.output as {
      approved?: boolean
      feedback?: string
      severity?: 'high' | 'medium' | 'low'
    }

    const cost = this.calculateCost(tokensUsed, agentContext)

    return {
      vote: {
        perspective,
        approved: output.approved ?? true,
        feedback: output.feedback ?? 'No feedback provided',
        severity: output.severity ?? 'low',
      },
      tokensUsed,
      cost,
    }
  }

  /**
   * Execute review using heuristic analysis (fallback method).
   * Performs basic checks based on perspective type.
   */
  private executeHeuristicReview(
    perspective: string,
    reviewContext: ReviewContext,
  ): PerspectiveReviewResult {
    const tokensUsed = this.estimateTokens(JSON.stringify(reviewContext))
    const cost = this.estimateCost(tokensUsed)

    switch (perspective) {
      case 'security':
        return {
          vote: this.performSecurityReview(reviewContext),
          tokensUsed,
          cost,
        }
      case 'performance':
        return {
          vote: this.performPerformanceReview(reviewContext),
          tokensUsed,
          cost,
        }
      case 'maintainability':
        return {
          vote: this.performMaintainabilityReview(reviewContext),
          tokensUsed,
          cost,
        }
      default:
        return this.executeGenericHeuristicReview(perspective, reviewContext)
    }
  }

  /**
   * Execute generic heuristic review for custom roles without backend.
   * Performs generic checks (architecture violations, test pass/fail).
   */
  private executeGenericHeuristicReview(
    role: string,
    reviewContext: ReviewContext,
  ): PerspectiveReviewResult {
    const tokensUsed = this.estimateTokens(JSON.stringify(reviewContext))
    const cost = this.estimateCost(tokensUsed)

    const issues: string[] = []
    if (reviewContext.architectureViolations.length > 0) {
      issues.push(
        `${reviewContext.architectureViolations.length} architecture violations`,
      )
    }
    if (!reviewContext.testPassed) {
      issues.push('Tests are failing')
    }

    return {
      vote: {
        perspective: role,
        approved: issues.length === 0,
        feedback:
          issues.length === 0
            ? `Generic heuristic review passed for '${role}'`
            : `Heuristic review for '${role}': ${issues.join('; ')} (heuristic — no backend available)`,
        severity: issues.length > 0 ? 'medium' : 'low',
      },
      tokensUsed,
      cost,
    }
  }

  // ---------------------------------------------------------------------------
  // Perspective-specific reviews (heuristic)
  // ---------------------------------------------------------------------------

  private performSecurityReview(context: ReviewContext): ReviewVote {
    const issues: string[] = []

    // Check for common security concerns in modified files
    const hasSensitiveFiles = context.modifiedFiles.some(
      (f) =>
        f.includes('auth') ||
        f.includes('password') ||
        f.includes('secret') ||
        f.includes('credential') ||
        f.includes('token'),
    )

    if (hasSensitiveFiles) {
      issues.push('Modified files include authentication/security-related code')
    }

    // Check test coverage for security-critical files
    if (hasSensitiveFiles && context.testCoverage < 80) {
      issues.push(
        `Security-related files have low test coverage (${context.testCoverage.toFixed(1)}%)`,
      )
    }

    // Check if tests pass
    if (!context.testPassed) {
      issues.push('Tests are failing, security cannot be verified')
    }

    const approved = issues.length === 0

    return {
      perspective: 'security',
      approved,
      feedback: approved
        ? 'No obvious security concerns detected'
        : `Security concerns: ${issues.join('; ')}`,
      severity:
        issues.length > 1 ? 'high' : issues.length === 1 ? 'medium' : 'low',
    }
  }

  private performPerformanceReview(context: ReviewContext): ReviewVote {
    const issues: string[] = []

    // Check for potential performance concerns
    const hasDataStructures = context.modifiedFiles.some(
      (f) =>
        f.includes('cache') ||
        f.includes('query') ||
        f.includes('loop') ||
        f.includes('batch'),
    )

    if (hasDataStructures) {
      issues.push('Modified files include performance-sensitive patterns')
    }

    // Check if tests exist for performance-critical code
    const hasTests = context.addedTests.length > 0
    if (hasDataStructures && !hasTests) {
      issues.push('Performance-sensitive code lacks dedicated tests')
    }

    const approved = issues.length === 0

    return {
      perspective: 'performance',
      approved,
      feedback: approved
        ? 'No obvious performance concerns detected'
        : `Performance concerns: ${issues.join('; ')}`,
      severity:
        issues.length > 1 ? 'high' : issues.length === 1 ? 'medium' : 'low',
    }
  }

  private performMaintainabilityReview(context: ReviewContext): ReviewVote {
    const issues: string[] = []

    // Check architecture violations
    if (context.architectureViolations.length > 0) {
      issues.push(
        `${context.architectureViolations.length} architecture pattern violations detected`,
      )
    }

    // Check test coverage
    if (context.testCoverage < 60) {
      issues.push(
        `Low test coverage (${context.testCoverage.toFixed(1)}%) affects maintainability`,
      )
    }

    // Check for tests
    if (context.addedTests.length === 0 && context.modifiedFiles.length > 0) {
      issues.push('No tests added for modified files')
    }

    const approved = issues.length === 0

    return {
      perspective: 'maintainability',
      approved,
      feedback: approved
        ? 'Code meets maintainability standards'
        : `Maintainability concerns: ${issues.join('; ')}`,
      severity:
        issues.length > 2 ? 'high' : issues.length > 0 ? 'medium' : 'low',
    }
  }

  // ---------------------------------------------------------------------------
  // Consensus logic
  // ---------------------------------------------------------------------------

  /**
   * Determine consensus from all votes using generalized 2/3 threshold.
   * - All approve → 'passed'
   * - ≥ threshold approve → 'passed-with-warnings'
   * - < threshold → 'rejected'
   *
   * Threshold is Math.floor(N * 2 / 3) with a minimum of 1 so that
   * 0 approvals always produces 'rejected' (Req 7.5, 7.8).
   */
  private determineConsensus(
    votes: ReviewVote[],
  ): 'passed' | 'passed-with-warnings' | 'rejected' {
    // Deduplicate by perspective — latest vote per reviewer wins
    const latestVotes = new Map<string, ReviewVote>()
    for (const vote of votes) {
      latestVotes.set(vote.perspective, vote)
    }

    const uniqueVotes = Array.from(latestVotes.values())
    const approvalCount = uniqueVotes.filter((v) => v.approved).length
    const totalCount = uniqueVotes.length

    if (totalCount === 0) return 'rejected'
    if (approvalCount === totalCount) return 'passed'

    // Min 1 ensures 0 approvals → rejected for any reviewer count
    const threshold = Math.max(1, Math.floor((totalCount * 2) / 3))
    if (approvalCount >= threshold) return 'passed-with-warnings'
    return 'rejected'
  }

  // ---------------------------------------------------------------------------
  // Backend and cost helpers
  // ---------------------------------------------------------------------------

  /**
   * Resolve backend for a specific reviewer following the fallback chain:
   * 1. reviewer.backend (if specified)
   * 2. phaseBackends['review-delivery'] (if set)
   * 3. defaultBackend (ultimate fallback)
   */
  private resolveReviewerBackend(
    reviewer: ReviewerConfig,
    context: AgentContext,
  ): ExecutorBackend | undefined {
    // If no backend registry available, return undefined to use heuristic
    if (!this.backendRegistry) {
      return undefined
    }

    // 1. Reviewer-specific backend
    if (reviewer.backend) {
      return this.backendRegistry.getBackend(reviewer.backend)
    }
    // 2. Phase backend for review-delivery
    if (this.backendRegistry.hasPhaseOverride('review-delivery')) {
      const phaseOverride =
        this.backendRegistry.getPhaseOverride('review-delivery')!
      return this.backendRegistry.getBackend(phaseOverride)
    }
    // 3. Default backend
    return this.backendRegistry.getBackend(context.config.defaultBackend)
  }

  private buildReviewPrompt(
    perspective: string,
    context: ReviewContext,
  ): string {
    return `You are a ${perspective} reviewer. Review the following code changes and provide your assessment.

Modified files: ${context.modifiedFiles.join(', ')}
Test coverage: ${context.testCoverage.toFixed(1)}%
Tests passing: ${context.testPassed ? 'Yes' : 'No'}
Architecture violations: ${context.architectureViolations.length}

Provide your review in JSON format:
{
  "approved": boolean,
  "feedback": "string explaining your assessment",
  "severity": "high" | "medium" | "low"
}`
  }

  private estimateTokens(text: string): number {
    // Rough estimate: 4 characters per token
    return Math.ceil(text.length / 4)
  }

  private estimateCost(tokens: number): number {
    // Rough estimate: $0.01 per 1000 tokens
    return (tokens / 1000) * 0.01
  }

  private estimateRoundCost(numPerspectives: number): number {
    return DEFAULT_COST_PER_ROUND_USD * numPerspectives
  }

  private calculateCost(tokensUsed: number, context: AgentContext): number {
    const backendName =
      context.preferredBackend ?? context.config.defaultBackend
    const backend = context.config.executorBackends.find(
      (b) => b.name === backendName,
    )
    const costPer1000 = backend?.costPer1000Tokens ?? 0.01
    return (tokensUsed / 1000) * costPer1000
  }

  // ---------------------------------------------------------------------------
  // Event helpers
  // ---------------------------------------------------------------------------

  private emitProgress(runId: string, message: string): void {
    this.eventBus.emit({
      type: 'agent:progress',
      runId,
      timestamp: new Date().toISOString(),
      phase: 'review-delivery',
      agent: 'review-council',
      data: { message },
    })
  }
}

// =============================================================================
// Types
// =============================================================================

interface ReviewContext {
  modifiedFiles: string[]
  addedTests: string[]
  architectureViolations: Array<{
    file: string
    pattern: string
    issue: string
    suggestion: string
  }>
  testPassed: boolean
  testCoverage: number
  spec: {
    featureName: string
    specPath: string
  }
}

// =============================================================================
// Pure helpers
// =============================================================================

function formatError(error: unknown): {
  message: string
  code?: string
  retryable: boolean
} {
  if (error instanceof Error) {
    return {
      message: error.message,
      retryable: false,
    }
  }
  return {
    message: String(error),
    retryable: false,
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new ReviewCouncilAgent instance.
 * @param deps Dependencies (eventBus optional, backendRegistry required for per-reviewer backend selection)
 */
export function createReviewCouncilAgent(
  deps: ReviewCouncilDependencies = {} as ReviewCouncilDependencies,
): ReviewCouncilAgent {
  return new ReviewCouncilAgent(deps)
}
