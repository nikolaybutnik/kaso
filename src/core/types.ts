/**
 * Core type definitions for KASO - Kiro-Enabled Agent Swarm Orchestrator
 * Contains all type definitions for phases, agents, execution state, and configuration
 */

import type { KASOConfig } from '../config/schema'
import type { ExecutorBackendConfig } from '../config/schema'

// ============================================================================
// Phase and System Enums/Types
// ============================================================================

/**
 * Phases in the 8-phase execution pipeline
 */
export type PhaseName =
  | 'intake'
  | 'validation'
  | 'architecture-analysis'
  | 'implementation'
  | 'architecture-review'
  | 'test-verification'
  | 'ui-validation'
  | 'review-delivery'
  | `custom-${string}`

/**
 * Possible states of an execution run
 */
export type RunStatus =
  | 'pending'
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled'

/**
 * Event types for the event bus system
 */
export type EventType =
  | 'phase:started'
  | 'phase:completed'
  | 'phase:failed'
  | 'phase:timeout'
  | 'run:started'
  | 'run:paused'
  | 'run:resumed'
  | 'run:completed'
  | 'run:failed'
  | 'run:cancelled'
  | 'run:budget_exceeded'
  | 'run:escalated'
  | 'agent:progress'
  | 'agent:error'
  | 'worktree:created'
  | 'worktree:deleted'
  | 'concurrency:acquired'
  | 'concurrency:released'
  | 'concurrency:queued'
  | 'concurrency:dequeued'
  | 'watcher:started'
  | 'watcher:ready'
  | 'watcher:stopped'
  | 'watcher:error'
  | 'watcher:status:detected'
  | 'watcher:status:removed'
  | 'watcher:spec:ready'
  | 'watcher:callback:error'

/**
 * Backend protocols supported by executor backends
 */
export type BackendProtocol = 'cli-stdout' | 'cli-json' | 'acp' | 'mcp'

// ============================================================================
// Execution State and History
// ============================================================================

/**
 * Execution event for the event system
 */
export interface ExecutionEvent {
  type: EventType
  runId: string
  timestamp: string
  phase?: PhaseName
  agent?: string
  data?: Record<string, unknown>
}

/**
 * Phase transition record
 */
export interface PhaseTransition {
  from?: PhaseName
  to: PhaseName
  timestamp: string
  trigger: 'success' | 'failure' | 'retry' | 'manual'
}

/**
 * Result of a single phase execution
 */
export interface PhaseResult {
  phase: PhaseName
  status: 'success' | 'failure' | 'cancelled' | 'timeout'
  output?: PhaseOutput
  error?: AgentError
  startedAt: string
  completedAt?: string
  duration?: number
}

/**
 * Persisted phase result record
 */
export interface PhaseResultRecord extends PhaseResult {
  runId: string
  sequence: number
}

/**
 * Status of an execution run
 */
export interface ExecutionRunStatus {
  runId: string
  specPath: string
  status: RunStatus
  currentPhase?: PhaseName
  phases: PhaseName[]
  startedAt: string
  pausedAt?: string
  completedAt?: string
  worktreePath?: string
  cost: number
}

/**
 * Persisted execution run record
 */
export interface ExecutionRunRecord extends ExecutionRunStatus {
  phaseResults: PhaseResultRecord[]
  logs: LogEntry[]
}

// ============================================================================
// Spec and Context Types
// ============================================================================

/**
 * Parsed markdown content
 */
export interface MarkdownSection {
  level: number
  title: string
  content: string
  codeBlocks: CodeBlock[]
  children: MarkdownSection[]
}

/**
 * Code block in markdown
 */
export interface CodeBlock {
  language?: string
  content: string
  lineStart: number
}

/**
 * Task item from task.md
 */
export interface TaskItem {
  id: string
  title: string
  status: 'complete' | 'incomplete'
  children: TaskItem[]
  line: number
}

/**
 * Parsed markdown document
 */
export interface ParsedMarkdown {
  rawContent: string
  sections: MarkdownSection[]
  codeBlocks: CodeBlock[]
  metadata: Record<string, string>
}

/**
 * Parsed spec from Kiro files
 */
export interface ParsedSpec {
  design?: ParsedMarkdown
  techSpec?: ParsedMarkdown
  taskList?: TaskItem[]
  missingFiles: string[]
  featureName: string
  specPath: string
}

/**
 * Steering files loaded from .kiro/rules/ and .kiro/hooks/
 */
export interface SteeringFiles {
  codingPractices?: string
  personality?: string
  commitConventions?: string
  hooks: Record<string, string>
}

/**
 * Main agent context passed to all agents
 */
export interface AgentContext {
  runId: string
  spec: ParsedSpec
  steering: SteeringFiles
  architecture?: ArchitectureContext
  phaseOutputs: Partial<Record<PhaseName, PhaseOutput>>
  config: KASOConfig
  worktreePath?: string
  backends: Record<string, ExecutorBackendConfig>
  preferredBackend?: string // Override default backend on retry (Req 16.2)
  removedFiles?: string[] // Files removed during context capping
  abortSignal?: AbortSignal // For cooperative cancellation detection (Req 13.5)
}

// ============================================================================
// Agent and Result Types
// ============================================================================

/**
 * Error from agent execution
 */
export interface AgentError {
  message: string
  code?: string
  stack?: string
  retryable: boolean
  data?: Record<string, unknown>
}

/**
 * Log entry from execution
 */
export interface LogEntry {
  timestamp: string
  level: 'debug' | 'info' | 'warn' | 'error'
  source: string
  message: string
  data?: Record<string, unknown>
}

/**
 * Generic phase output
 */
export interface PhaseOutput {
  [key: string]: unknown
}

/**
 * Result from agent execution
 */
export interface AgentResult {
  success: boolean
  output?: PhaseOutput
  error?: AgentError
  duration?: number
  tokensUsed?: number
}

// ============================================================================
// Phase-Specific Output Types
// ============================================================================

/**
 * Output from Intake phase (Phase 1)
 */
export interface AssembledContext extends PhaseOutput {
  featureName: string
  designDoc?: ParsedMarkdown
  techSpec?: ParsedMarkdown
  taskList?: TaskItem[]
  architectureDocs: Record<string, ParsedMarkdown>
  dependencies: Record<string, string>
  removedFiles: string[]
}

/**
 * Output from Validation phase (Phase 2)
 */
export interface ValidationReport extends PhaseOutput {
  approved: boolean
  issues: {
    type: 'api-contract' | 'db-schema' | 'error-handling' | 'contradiction'
    severity: 'error' | 'warning'
    description: string
    suggestion?: string
    location?: string
  }[]
  suggestedFixes: string[]
}

/**
 * Output from Architecture Analysis phase (Phase 3)
 */
export interface ArchitectureContext extends PhaseOutput {
  patterns: Array<{
    name: string
    description: string
    applicableFiles: string[]
    constraints: string[]
  }>
  moduleBoundaries: Array<{
    module: string
    boundaries: string[]
    violations: string[]
  }>
  adrs: Record<string, ParsedMarkdown>
  adrsFound: number
  potentialViolations: string[]
}

/**
 * Output from Implementation phase (Phase 4)
 */
export interface ImplementationResult extends PhaseOutput {
  modifiedFiles: string[]
  addedTests: string[]
  duration: number
  backend: string
  selfCorrectionAttempts: number
}

/**
 * Output from Architecture Review phase (Phase 5)
 */
export interface ArchitectureReview extends PhaseOutput {
  approved: boolean
  violations: Array<{
    file: string
    pattern: string
    issue: string
    suggestion: string
  }>
  modifiedFiles: string[]
}

/**
 * Output from Test & Verification phase (Phase 6)
 */
export interface TestReport extends PhaseOutput {
  passed: boolean
  coverage: number
  testFailures: Array<{
    test: string
    error: string
    stack?: string
  }>
  testsRun: number
  duration: number
  generatedTests?: string[]
}

/**
 * Output from UI/UX Validation phase (Phase 7)
 */
export interface UIReview extends PhaseOutput {
  approved: boolean
  screenshots: Array<{
    route: string
    path: string
    baseline?: string
    diff?: string
  }>
  uiIssues: Array<{
    type: 'visual' | 'responsive' | 'accessibility' | 'consistency'
    description: string
    component?: string
    severity: 'high' | 'medium' | 'low'
  }>
  skipped?: boolean
}

/**
 * Output from Review Council (Phase 8)
 */
export interface ReviewCouncilResult extends PhaseOutput {
  consensus: 'passed' | 'passed-with-warnings' | 'rejected'
  votes: Array<{
    perspective: 'security' | 'performance' | 'maintainability'
    approved: boolean
    feedback: string
    severity: 'high' | 'medium' | 'low'
  }>
  rounds: number
  cost: number
}

/**
 * Output from Delivery phase (Phase 8)
 */
export interface DeliveryResult extends PhaseOutput {
  branch: string
  commits: string[]
  prUrl?: string
  summary: string
}

// ============================================================================
// Backend Types
// ============================================================================

/**
 * Base request to executor backend
 */
export interface BackendRequest {
  id: string
  context: AgentContext
  phase: PhaseName
  streamProgress: boolean
}

/**
 * Response from executor backend
 */
export interface BackendResponse {
  id: string
  success: boolean
  output?: PhaseOutput
  error?: string
  tokensUsed?: number
  duration?: number
}

/**
 * Progress event from backend
 */
export interface BackendProgressEvent {
  type: string
  timestamp: string
  message: string
  data?: Record<string, unknown>
}

/**
 * Information about a git worktree created for a run
 */
export interface WorktreeInfo {
  readonly path: string
  readonly branch: string
  readonly runId: string
}
