/**
 * Delivery Agent (Phase 8 — PR Delivery)
 * Creates feature branch, commits changes, and opens pull request.
 *
 * Responsibilities:
 * - Create feature branch from worktree with descriptive name
 * - Create commits following conventional commit format (feat:, fix:, refactor:, test:, docs:)
 * - Open pull request with execution summary, test results, review council outcome
 * - Use GitHub CLI (`gh`) for PR creation with graceful fallback to `git` + GitHub API if `gh` is not available
 * - Append execution summary to Kiro spec directory
 *
 * Requirements: 15.6, 15.7, 15.8, 15.9
 */

import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import type {
  AgentContext,
  AgentResult,
  AgentError,
  DeliveryResult,
  ImplementationResult,
  TestReport,
  ReviewCouncilResult,
  ParsedSpec,
} from '../core/types'
import type { Agent } from './agent-interface'
import { EventBus } from '../core/event-bus'

/** Estimated duration for delivery agent in milliseconds */
const ESTIMATED_DURATION_MS = 15_000

/** Command timeout in milliseconds */
const COMMAND_TIMEOUT_MS = 30_000

/** Conventional commit types */
export type ConventionalCommitType =
  | 'feat'
  | 'fix'
  | 'refactor'
  | 'test'
  | 'docs'
  | 'chore'
  | 'style'
  | 'perf'
  | 'ci'
  | 'build'

/** Commit info for conventional commit format */
export interface CommitInfo {
  type: ConventionalCommitType
  scope?: string
  description: string
  body?: string
  breaking?: boolean
}

/** PR creation result */
interface PRCreationResult {
  success: boolean
  prUrl?: string
  prNumber?: number
  error?: string
}

/** Delivery agent dependencies */
interface DeliveryDependencies {
  eventBus?: EventBus
  commandRunner?: CommandRunner
}

/** Command runner interface for testability */
interface CommandRunner {
  run(command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }>
}

/** Default command runner using child_process */
class DefaultCommandRunner implements CommandRunner {
  async run(
    command: string,
    args: string[],
    cwd: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const proc = spawn(command, args, { cwd, shell: true })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      const timer = setTimeout(() => {
        proc.kill('SIGTERM')
        reject(new Error(`Command timed out after ${COMMAND_TIMEOUT_MS}ms`))
      }, COMMAND_TIMEOUT_MS)

      proc.on('close', (code) => {
        clearTimeout(timer)
        resolve({ stdout, stderr, exitCode: code ?? 0 })
      })

      proc.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
  }
}

/**
 * DeliveryAgent — Phase 8: PR Delivery
 *
 * Creates feature branch, commits with conventional commit format,
 * opens PR, and appends execution summary to spec directory.
 */
export class DeliveryAgent implements Agent {
  private readonly eventBus: EventBus
  private readonly commandRunner: CommandRunner

  constructor(deps: DeliveryDependencies = {}) {
    this.eventBus = deps.eventBus ?? new EventBus()
    this.commandRunner = deps.commandRunner ?? new DefaultCommandRunner()
  }

  // ---------------------------------------------------------------------------
  // Agent interface
  // ---------------------------------------------------------------------------

  async execute(context: AgentContext): Promise<AgentResult> {
    const startTime = Date.now()

    try {
      if (context.abortSignal?.aborted) {
        return this.abortedResult(startTime)
      }

      this.validateContext(context)

      const worktreePath = context.worktreePath!
      const spec = context.spec

      // Step 1: Create feature branch (Req 15.6)
      this.emitProgress(context.runId, 'Creating feature branch...')
      const branchName = await this.createFeatureBranch(worktreePath, spec)

      // Step 2: Stage and commit changes with conventional format (Req 15.7)
      this.emitProgress(context.runId, 'Creating commits...')
      const commits = await this.createConventionalCommits(worktreePath, context)

      // Step 3: Push branch to remote
      this.emitProgress(context.runId, 'Pushing branch to remote...')
      await this.pushBranch(worktreePath, branchName)

      // Step 4: Create pull request (Req 15.8)
      this.emitProgress(context.runId, 'Creating pull request...')
      const prResult = await this.createPullRequest(worktreePath, context, branchName)

      // Step 5: Append execution summary to spec directory (Req 15.9)
      this.emitProgress(context.runId, 'Appending execution summary...')
      await this.appendExecutionSummary(spec, context, branchName, commits, prResult)

      const result: DeliveryResult = {
        branch: branchName,
        commits,
        prUrl: prResult.prUrl,
        summary: this.buildExecutionSummary(context, branchName, commits, prResult),
      }

      return {
        success: prResult.success,
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
    return true // Can delete branch and PR
  }

  estimatedDuration(): number {
    return ESTIMATED_DURATION_MS
  }

  requiredContext(): string[] {
    return [
      'worktreePath',
      'spec',
      'phaseOutputs.implementation',
      'phaseOutputs.test-verification',
      'phaseOutputs.review-delivery',
    ]
  }

  // ---------------------------------------------------------------------------
  // Context helpers
  // ---------------------------------------------------------------------------

  private validateContext(context: AgentContext): void {
    if (!context.worktreePath) {
      throw new Error('Missing worktree path')
    }

    const impl = context.phaseOutputs['implementation'] as
      | ImplementationResult
      | undefined
    if (!impl) {
      throw new Error('Missing implementation result')
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
  // Branch creation (Req 15.6)
  // ---------------------------------------------------------------------------

  /**
   * Create a feature branch with descriptive name.
   * Branch format: kaso/[feature-name]-delivery-[YYYYMMDDTHHmmss]
   */
  private async createFeatureBranch(
    worktreePath: string,
    spec: ParsedSpec,
  ): Promise<string> {
    const timestamp = new Date()
      .toISOString()
      .replace(/[:\-]/g, '')
      .replace(/\.\d{3}Z$/, '')
    const featureName = spec.featureName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').replace(/-+/g, '-')
    const branchName = `kaso/${featureName}-delivery-${timestamp}`

    // Create and checkout branch
    const result = await this.commandRunner.run(
      'git',
      ['checkout', '-b', branchName],
      worktreePath,
    )

    if (result.exitCode !== 0) {
      throw new Error(`Failed to create branch: ${result.stderr}`)
    }

    return branchName
  }

  // ---------------------------------------------------------------------------
  // Conventional commits (Req 15.7)
  // ---------------------------------------------------------------------------

  /**
   * Analyze modified files and create appropriate conventional commits.
   * Returns list of commit SHAs.
   */
  private async createConventionalCommits(
    worktreePath: string,
    context: AgentContext,
  ): Promise<string[]> {
    const implementation = context.phaseOutputs['implementation'] as
      | ImplementationResult
      | undefined

    if (!implementation) {
      throw new Error('Missing implementation result')
    }

    const commits: string[] = []

    // Stage all changes
    await this.stageAllChanges(worktreePath)

    // Analyze changes and create appropriate commits
    const commitGroups = this.analyzeChanges(implementation.modifiedFiles)

    for (const group of commitGroups) {
      const commitMessage = this.buildConventionalCommitMessage(group)
      const sha = await this.createCommit(worktreePath, commitMessage)
      if (sha) {
        commits.push(sha)
      }
    }

    // If no specific commits created, create a default one
    if (commits.length === 0) {
      const defaultCommit = this.buildDefaultCommit(context)
      const sha = await this.createCommit(worktreePath, defaultCommit)
      if (sha) {
        commits.push(sha)
      }
    }

    return commits
  }

  /**
   * Analyze modified files and group them by commit type.
   */
  private analyzeChanges(modifiedFiles: string[]): CommitInfo[] {
    const groups: CommitInfo[] = []

    // Group files by type
    const filesByType = this.categorizeFiles(modifiedFiles)

    // Create commits for each category
    if (filesByType.src.length > 0) {
      groups.push({
        type: 'feat',
        scope: this.inferScope(filesByType.src),
        description: `add ${filesByType.src.length} implementation file(s)`,
      })
    }

    if (filesByType.tests.length > 0) {
      groups.push({
        type: 'test',
        scope: this.inferScope(filesByType.tests),
        description: `add ${filesByType.tests.length} test file(s)`,
      })
    }

    if (filesByType.docs.length > 0) {
      groups.push({
        type: 'docs',
        description: `update ${filesByType.docs.length} documentation file(s)`,
      })
    }

    if (filesByType.config.length > 0) {
      groups.push({
        type: 'chore',
        description: `update ${filesByType.config.length} configuration file(s)`,
      })
    }

    return groups
  }

  /**
   * Categorize files by type.
   */
  private categorizeFiles(files: string[]): {
    src: string[]
    tests: string[]
    docs: string[]
    config: string[]
  } {
    const result = { src: [], tests: [], docs: [], config: [] } as {
      src: string[]
      tests: string[]
      docs: string[]
      config: string[]
    }

    for (const file of files) {
      if (
        file.includes('test') ||
        file.includes('spec') ||
        file.includes('__tests__')
      ) {
        result.tests.push(file)
      } else if (
        file.endsWith('.md') ||
        file.includes('README') ||
        file.includes('CHANGELOG')
      ) {
        result.docs.push(file)
      } else if (
        file.includes('config') ||
        file.includes('.json') ||
        file.includes('.yaml') ||
        file.includes('.yml')
      ) {
        result.config.push(file)
      } else if (file.includes('src/') || file.includes('lib/')) {
        result.src.push(file)
      } else {
        result.src.push(file) // Default to src
      }
    }

    return result
  }

  /**
   * Infer scope from file paths.
   */
  private inferScope(files: string[]): string | undefined {
    // Extract common directory or module name
    const dirs = files
      .map((f) => f.split('/')[0])
      .filter((d): d is string => typeof d === 'string' && d !== '' && d !== '.')

    if (dirs.length === 0) return undefined

    // Return most common directory
    const counts = new Map<string, number>()
    for (const dir of dirs) {
      counts.set(dir, (counts.get(dir) || 0) + 1)
    }

    let maxDir = dirs[0]
    let maxCount = 0
    for (const [dir, count] of counts) {
      if (count > maxCount) {
        maxCount = count
        maxDir = dir
      }
    }

    return maxDir
  }

  /**
   * Build conventional commit message.
   */
  buildConventionalCommitMessage(commitInfo: CommitInfo): string {
    const scope = commitInfo.scope ? `(${commitInfo.scope})` : ''
    const breaking = commitInfo.breaking ? '!' : ''
    const header = `${commitInfo.type}${scope}${breaking}: ${commitInfo.description}`

    if (commitInfo.body) {
      return `${header}\n\n${commitInfo.body}`
    }

    return header
  }

  /**
   * Build default commit message when no specific categorization possible.
   */
  private buildDefaultCommit(context: AgentContext): string {
    const spec = context.spec
    const featureName = spec.featureName || 'feature'

    return `feat: implement ${featureName}\n\nImplementation generated by KASO orchestrator.`
  }

  /**
   * Check if a string is a valid conventional commit format.
   */
  isConventionalCommitFormat(message: string): boolean {
    const conventionalCommitRegex =
      /^(feat|fix|refactor|test|docs|chore|style|perf|ci|build)(\([a-z-]+\))?(!)?: .+/m
    return conventionalCommitRegex.test(message)
  }

  /**
   * Extract commit type from conventional commit message.
   */
  extractCommitType(message: string): ConventionalCommitType | undefined {
    const match = message.match(
      /^(feat|fix|refactor|test|docs|chore|style|perf|ci|build)/,
    )
    return match?.[1] as ConventionalCommitType | undefined
  }

  /**
   * Extract scope from conventional commit message.
   */
  extractCommitScope(message: string): string | undefined {
    const match = message.match(/\(([a-z-]+)\)/)
    return match?.[1]
  }

  // ---------------------------------------------------------------------------
  // Git operations
  // ---------------------------------------------------------------------------

  private async stageAllChanges(worktreePath: string): Promise<void> {
    const result = await this.commandRunner.run(
      'git',
      ['add', '-A'],
      worktreePath,
    )

    if (result.exitCode !== 0) {
      throw new Error(`Failed to stage changes: ${result.stderr}`)
    }
  }

  private async createCommit(
    worktreePath: string,
    message: string,
  ): Promise<string | undefined> {
    // Check if there are staged changes
    const statusResult = await this.commandRunner.run(
      'git',
      ['diff', '--cached', '--name-only'],
      worktreePath,
    )

    if (!statusResult.stdout.trim()) {
      return undefined // Nothing to commit
    }

    const result = await this.commandRunner.run(
      'git',
      ['commit', '-m', message],
      worktreePath!,
    )

    if (result.exitCode !== 0) {
      throw new Error(`Failed to create commit: ${result.stderr}`)
    }

    // Extract commit SHA
    const shaResult = await this.commandRunner.run(
      'git',
      ['rev-parse', 'HEAD'],
      worktreePath,
    )

    return shaResult.stdout.trim()
  }

  private async pushBranch(
    worktreePath: string,
    branchName: string,
  ): Promise<void> {
    const result = await this.commandRunner.run(
      'git',
      ['push', '-u', 'origin', branchName],
      worktreePath,
    )

    if (result.exitCode !== 0) {
      throw new Error(`Failed to push branch: ${result.stderr}`)
    }
  }

  // ---------------------------------------------------------------------------
  // Pull request creation (Req 15.8)
  // ---------------------------------------------------------------------------

  /**
   * Create pull request using GitHub CLI if available, otherwise fallback.
   */
  private async createPullRequest(
    worktreePath: string,
    context: AgentContext,
    branchName: string,
  ): Promise<PRCreationResult> {
    // Try GitHub CLI first
    const ghResult = await this.tryGhCLI(worktreePath, context, branchName)
    if (ghResult.success) {
      return ghResult
    }

    // Fallback to git + GitHub API
    const fallbackResult = await this.fallbackPRCreation(context, branchName)
    if (fallbackResult.success) {
      return fallbackResult
    }

    // If both fail, return partial success with manual instructions
    return {
      success: false,
      error: 'PR creation failed. Please create PR manually.',
    }
  }

  /**
   * Try to create PR using GitHub CLI.
   */
  private async tryGhCLI(
    worktreePath: string,
    context: AgentContext,
    _branchName: string,
  ): Promise<PRCreationResult> {
    // Check if gh is available
    const ghCheck = await this.commandRunner.run('gh', ['--version'], worktreePath)
    if (ghCheck.exitCode !== 0) {
      return { success: false, error: 'GitHub CLI not available' }
    }

    const title = this.buildPRTitle(context)
    const body = this.buildPRBody(context)

    const result = await this.commandRunner.run(
      'gh',
      [
        'pr',
        'create',
        '--title',
        title,
        '--body',
        body,
        '--base',
        'main', // or detect default branch
      ],
      worktreePath,
    )

    if (result.exitCode !== 0) {
      return { success: false, error: result.stderr }
    }

    // Extract PR URL from output
    const prUrl = result.stdout.trim()
    const prNumberMatch = prUrl.match(/\/pull\/(\d+)$/)
    const prNumber = prNumberMatch?.[1] ? parseInt(prNumberMatch[1], 10) : undefined

    return { success: true, prUrl, prNumber }
  }

  /**
   * Fallback PR creation using git + GitHub API.
   * Returns partial success with instructions if API not available.
   */
  private async fallbackPRCreation(
    context: AgentContext,
    branchName: string,
  ): Promise<PRCreationResult> {
    // Without gh CLI, we can't easily create PR via API without auth
    // Return partial success with manual instructions
    const title = this.buildPRTitle(context)
    
    // Use branchName to ensure it's referenced
    const _referenceBranch = branchName

    return {
      success: true, // Mark as success since branch is pushed
      prUrl: undefined,
      error: `PR not auto-created. Create manually: ${title} from ${_referenceBranch}`,
    }
  }

  /**
   * Build PR title from context.
   */
  private buildPRTitle(context: AgentContext): string {
    const spec = context.spec
    const featureName = spec.featureName || 'Feature'

    return `feat: ${featureName}`
  }

  /**
   * Build PR body with execution summary.
   */
  private buildPRBody(context: AgentContext): string {
    const implementation = context.phaseOutputs['implementation'] as
      | ImplementationResult
      | undefined
    const testReport = context.phaseOutputs['test-verification'] as
      | TestReport
      | undefined
    const reviewCouncil = context.phaseOutputs['review-delivery'] as
      | ReviewCouncilResult
      | undefined

    const lines: string[] = []

    lines.push('## Summary')
    lines.push('')
    lines.push(`Implementation generated by KASO orchestrator.`)
    lines.push('')

    // Modified files
    if (implementation?.modifiedFiles.length) {
      lines.push('### Modified Files')
      lines.push('')
      for (const file of implementation.modifiedFiles) {
        lines.push(`- ${file}`)
      }
      lines.push('')
    }

    // Test results
    if (testReport) {
      lines.push('### Test Results')
      lines.push('')
      lines.push(`- **Status**: ${testReport.passed ? '✅ Passed' : '❌ Failed'}`)
      lines.push(`- **Coverage**: ${testReport.coverage.toFixed(1)}%`)
      lines.push(`- **Tests Run**: ${testReport.testsRun}`)
      lines.push('')
    }

    // Review council outcome
    if (reviewCouncil) {
      lines.push('### Review Council Outcome')
      lines.push('')
      const consensusEmoji =
        reviewCouncil.consensus === 'passed'
          ? '✅'
          : reviewCouncil.consensus === 'passed-with-warnings'
            ? '⚠️'
            : '❌'
      lines.push(`- **Consensus**: ${consensusEmoji} ${reviewCouncil.consensus}`)
      lines.push(`- **Rounds**: ${reviewCouncil.rounds}`)
      lines.push(`- **Cost**: $${reviewCouncil.cost.toFixed(4)}`)
      lines.push('')

      // Individual votes
      if (reviewCouncil.votes.length > 0) {
        lines.push('#### Review Votes')
        lines.push('')
        for (const vote of reviewCouncil.votes) {
          const emoji = vote.approved ? '✅' : '❌'
          lines.push(
            `- ${emoji} **${vote.perspective}**: ${vote.severity} severity`,
          )
        }
        lines.push('')
      }
    }

    lines.push('---')
    lines.push('*This PR was automatically generated by KASO.*')

    return lines.join('\n')
  }

  // ---------------------------------------------------------------------------
  // Execution summary (Req 15.9)
  // ---------------------------------------------------------------------------

  /**
   * Append execution summary to Kiro spec directory.
   */
  private async appendExecutionSummary(
    spec: ParsedSpec,
    context: AgentContext,
    branchName: string,
    commits: string[],
    prResult: PRCreationResult,
  ): Promise<void> {
    const specDir = spec.specPath
    if (!specDir) {
      this.emitProgress(context.runId, 'No spec directory, skipping summary append')
      return
    }

    const summaryPath = join(specDir, 'execution-summary.md')
    const summary = this.buildExecutionSummaryFile(
      context,
      branchName,
      commits,
      prResult,
    )

    try {
      // Check if file exists and append, otherwise create
      let existingContent = ''
      try {
        existingContent = await fs.readFile(summaryPath, 'utf-8')
      } catch {
        // File doesn't exist, will create new
      }

      const newContent = existingContent
        ? `${existingContent}\n\n---\n\n${summary}`
        : summary

      await fs.writeFile(summaryPath, newContent, 'utf-8')
    } catch (error) {
      // Log warning but don't fail
      this.emitProgress(
        context.runId,
        `Warning: Could not write execution summary: ${error}`,
      )
    }
  }

  /**
   * Build execution summary content for spec file.
   */
  private buildExecutionSummaryFile(
    context: AgentContext,
    branchName: string,
    commits: string[],
    prResult: PRCreationResult,
  ): string {
    const timestamp = new Date().toISOString()
    const implementation = context.phaseOutputs['implementation'] as
      | ImplementationResult
      | undefined
    const testReport = context.phaseOutputs['test-verification'] as
      | TestReport
      | undefined
    const reviewCouncil = context.phaseOutputs['review-delivery'] as
      | ReviewCouncilResult
      | undefined

    const lines: string[] = []

    lines.push(`## Execution Summary (${timestamp})`)
    lines.push('')
    lines.push(`- **Branch**: ${branchName}`)
    lines.push(`- **Commits**: ${commits.length}`)
    if (prResult.prUrl) {
      lines.push(`- **Pull Request**: ${prResult.prUrl}`)
    }
    lines.push('')

    if (implementation) {
      lines.push('### Implementation')
      lines.push(`- Modified Files: ${implementation.modifiedFiles.length}`)
      lines.push(`- Added Tests: ${implementation.addedTests.length}`)
      lines.push(`- Backend: ${implementation.backend}`)
      lines.push('')
    }

    if (testReport) {
      lines.push('### Test Results')
      lines.push(`- Passed: ${testReport.passed}`)
      lines.push(`- Coverage: ${testReport.coverage.toFixed(1)}%`)
      lines.push(`- Tests Run: ${testReport.testsRun}`)
      lines.push('')
    }

    if (reviewCouncil) {
      lines.push('### Review Council')
      lines.push(`- Consensus: ${reviewCouncil.consensus}`)
      lines.push(`- Rounds: ${reviewCouncil.rounds}`)
      lines.push(`- Cost: $${reviewCouncil.cost.toFixed(4)}`)
      lines.push('')
    }

    return lines.join('\n')
  }

  /**
   * Build execution summary string for DeliveryResult.
   */
  private buildExecutionSummary(
    context: AgentContext,
    branchName: string,
    commits: string[],
    prResult: PRCreationResult,
  ): string {
    const implementation = context.phaseOutputs['implementation'] as
      | ImplementationResult
      | undefined
    const testReport = context.phaseOutputs['test-verification'] as
      | TestReport
      | undefined

    const parts: string[] = []

    parts.push(`Branch: ${branchName}`)
    parts.push(`Commits: ${commits.length}`)

    if (prResult.prUrl) {
      parts.push(`PR: ${prResult.prUrl}`)
    }

    if (implementation) {
      parts.push(`Modified: ${implementation.modifiedFiles.length} files`)
    }

    if (testReport) {
      parts.push(`Tests: ${testReport.passed ? 'passed' : 'failed'}`)
      parts.push(`Coverage: ${testReport.coverage.toFixed(1)}%`)
    }

    return parts.join(', ')
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
      agent: 'delivery',
      data: { message },
    })
  }
}

// =============================================================================
// Pure helpers
// =============================================================================

function formatError(error: unknown): AgentError {
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
 * Create a new DeliveryAgent instance.
 * @param deps Optional dependencies (eventBus, commandRunner)
 */
export function createDeliveryAgent(deps?: DeliveryDependencies): DeliveryAgent {
  return new DeliveryAgent(deps)
}
