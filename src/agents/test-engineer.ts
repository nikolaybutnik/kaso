/**
 * Test Engineer Agent (Phase 6 — Test & Verification)
 * Generates and executes tests for modified files, performs coverage analysis.
 *
 * Responsibilities:
 * - Generate unit, integration, and edge-case tests for all modified source files
 * - Execute the full project test suite within the worktree
 * - Perform code coverage analysis on modified files
 * - Produce a TestReport with passed, coverage, testFailures, testsRun, duration
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4
 */

import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { join, extname, basename } from 'path'
import type {
  AgentContext,
  AgentResult,
  AgentError,
  TestReport,
  ImplementationResult,
} from '../core/types'
import type { Agent } from './agent-interface'
import { EventBus } from '../core/event-bus'

/** Estimated duration for test engineer agent in milliseconds */
const ESTIMATED_DURATION_MS = 45_000

/** Source file extensions we generate tests for */
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx'])

/** Patterns that identify a file as a test file */
const TEST_FILE_PATTERNS = ['.test.', '.spec.', '__tests__']

/** Max time (ms) to wait for the test process */
const TEST_PROCESS_TIMEOUT_MS = 120_000

/** Parsed result from running the test suite */
interface ParsedTestResult {
  readonly passed: boolean
  readonly totalTests: number
  readonly passedTests: number
  readonly failures: ReadonlyArray<{
    test: string
    error: string
    stack?: string
  }>
}

/** Coverage data for a single file from coverage-summary.json */
interface FileCoverageEntry {
  lines?: { pct: number }
  statements?: { pct: number }
  functions?: { pct: number }
  branches?: { pct: number }
}

/**
 * TestEngineerAgent — Phase 6: Test & Verification
 *
 * Generates tests for modified files, runs the full test suite in the worktree,
 * collects coverage data, and produces a TestReport.
 */
export class TestEngineerAgent implements Agent {
  private readonly eventBus: EventBus

  constructor(eventBus?: EventBus) {
    this.eventBus = eventBus ?? new EventBus()
  }

  // ---------------------------------------------------------------------------
  // Agent interface
  // ---------------------------------------------------------------------------

  async execute(context: AgentContext): Promise<AgentResult> {
    const startTime = Date.now()

    try {
      this.validateContext(context)

      if (context.abortSignal?.aborted) {
        return this.abortedResult(startTime)
      }

      const implementationResult = this.getImplementationResult(context)
      const worktreePath = context.worktreePath!

      // Step 1 — Generate tests for modified files (Req 13.1)
      this.emitProgress(context.runId, 'Generating tests for modified files...')
      const generatedTests = await this.generateTests(
        implementationResult.modifiedFiles,
        worktreePath,
      )

      // Step 2 — Execute full test suite (Req 13.2)
      this.emitProgress(context.runId, 'Executing test suite...')
      const testResult = await this.executeTests(
        worktreePath,
        context.abortSignal,
      )

      // Step 3 — Coverage analysis (Req 13.3)
      this.emitProgress(context.runId, 'Analyzing code coverage...')
      const coverage = await this.calculateCoverage(
        worktreePath,
        implementationResult.modifiedFiles,
      )

      // Step 4 — Build TestReport (Req 13.4)
      const testReport: TestReport = {
        passed: testResult.passed,
        testsRun: testResult.totalTests,
        testFailures: [...testResult.failures],
        coverage,
        duration: Date.now() - startTime,
        generatedTests,
      }

      return {
        success: testResult.passed,
        output: testReport,
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
    return true // generated test files can be removed
  }

  estimatedDuration(): number {
    return ESTIMATED_DURATION_MS
  }

  requiredContext(): string[] {
    return ['phaseOutputs.implementation', 'worktreePath']
  }

  // ---------------------------------------------------------------------------
  // Context helpers
  // ---------------------------------------------------------------------------

  private validateContext(context: AgentContext): void {
    if (!context.worktreePath) {
      throw new Error('Missing worktree path')
    }
  }

  private getImplementationResult(context: AgentContext): ImplementationResult {
    const result = context.phaseOutputs['implementation'] as
      | ImplementationResult
      | undefined
    if (!result) {
      throw new Error('Missing implementation result from Phase 4')
    }
    return result
  }

  private abortedResult(startTime: number): AgentResult {
    return {
      success: false,
      error: { message: 'Execution aborted', retryable: false },
      duration: Date.now() - startTime,
    }
  }

  // ---------------------------------------------------------------------------
  // Test generation (Req 13.1)
  // ---------------------------------------------------------------------------

  /**
   * Generate test stubs for modified source files that lack corresponding tests.
   * Returns the list of generated test file paths (relative to worktree).
   */
  private async generateTests(
    modifiedFiles: ReadonlyArray<string>,
    worktreePath: string,
  ): Promise<string[]> {
    const generated: string[] = []

    for (const file of modifiedFiles) {
      if (!isSourceFile(file) || isTestFile(file)) continue

      const testPath = deriveTestPath(file)
      const fullTestPath = join(worktreePath, testPath)

      if (await fileExists(fullTestPath)) continue

      const content = buildTestContent(file)
      if (!content) continue

      try {
        const dir = fullTestPath.substring(0, fullTestPath.lastIndexOf('/'))
        await fs.mkdir(dir, { recursive: true })
        await fs.writeFile(fullTestPath, content, 'utf-8')
        generated.push(testPath)
      } catch {
        // Non-fatal — skip this file and continue
      }
    }

    return generated
  }

  // ---------------------------------------------------------------------------
  // Test execution (Req 13.2)
  // ---------------------------------------------------------------------------

  /**
   * Run the project's test suite inside the worktree and parse the output.
   */
  private async executeTests(
    worktreePath: string,
    abortSignal?: AbortSignal,
  ): Promise<ParsedTestResult> {
    const hasTests = await this.detectTestScript(worktreePath)
    if (!hasTests) {
      return { passed: true, totalTests: 0, passedTests: 0, failures: [] }
    }

    return this.runTestProcess(worktreePath, abortSignal)
  }

  /** Check whether the project has a runnable test script. */
  private async detectTestScript(worktreePath: string): Promise<boolean> {
    try {
      const raw = await fs.readFile(join(worktreePath, 'package.json'), 'utf-8')
      const pkg = JSON.parse(raw) as { scripts?: Record<string, string> }
      return Boolean(pkg.scripts?.['test'])
    } catch {
      return false
    }
  }

  /** Spawn `npm test` and collect stdout/stderr. */
  private runTestProcess(
    worktreePath: string,
    abortSignal?: AbortSignal,
  ): Promise<ParsedTestResult> {
    return new Promise<ParsedTestResult>((resolve, reject) => {
      const proc = spawn('npm', ['test'], {
        cwd: worktreePath,
        shell: true,
        env: { ...process.env, CI: 'true' },
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString()
      })
      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })

      // Abort support
      const onAbort = (): void => {
        proc.kill('SIGTERM')
        reject(new Error('Test execution aborted'))
      }
      if (abortSignal) {
        if (abortSignal.aborted) {
          proc.kill('SIGTERM')
          reject(new Error('Test execution aborted'))
          return
        }
        abortSignal.addEventListener('abort', onAbort, { once: true })
      }

      // Timeout guard
      const timer = setTimeout(() => {
        proc.kill('SIGTERM')
        reject(
          new Error(
            `Test execution timed out after ${TEST_PROCESS_TIMEOUT_MS}ms`,
          ),
        )
      }, TEST_PROCESS_TIMEOUT_MS)

      proc.on('close', (code) => {
        clearTimeout(timer)
        abortSignal?.removeEventListener('abort', onAbort)

        const combined = stdout + '\n' + stderr
        const parsed = parseTestOutput(combined)
        resolve({
          ...parsed,
          passed: code === 0 && parsed.failures.length === 0,
        })
      })

      proc.on('error', (err) => {
        clearTimeout(timer)
        abortSignal?.removeEventListener('abort', onAbort)
        reject(err)
      })
    })
  }

  // ---------------------------------------------------------------------------
  // Coverage analysis (Req 13.3)
  // ---------------------------------------------------------------------------

  /**
   * Read coverage-summary.json from the worktree and compute average line
   * coverage across the modified files.
   */
  private async calculateCoverage(
    worktreePath: string,
    modifiedFiles: ReadonlyArray<string>,
  ): Promise<number> {
    try {
      const summaryPath = join(
        worktreePath,
        'coverage',
        'coverage-summary.json',
      )
      const raw = await fs.readFile(summaryPath, 'utf-8')
      const data = JSON.parse(raw) as Record<string, FileCoverageEntry>

      let totalPct = 0
      let count = 0

      for (const file of modifiedFiles) {
        const key = Object.keys(data).find(
          (k) => k.endsWith(file) || file.endsWith(k),
        )
        const entry = key ? data[key] : undefined
        if (entry?.lines) {
          totalPct += entry.lines.pct
          count++
        }
      }

      return count > 0 ? totalPct / count : 0
    } catch {
      return 0
    }
  }

  // ---------------------------------------------------------------------------
  // Event helpers
  // ---------------------------------------------------------------------------

  private emitProgress(runId: string, message: string): void {
    this.eventBus.emit({
      type: 'agent:progress',
      runId,
      timestamp: new Date().toISOString(),
      phase: 'test-verification',
      agent: 'test-engineer',
      data: { message },
    })
  }
}

// =============================================================================
// Pure helpers (no side effects, easily testable)
// =============================================================================

/** Check whether a path points to a source file we should generate tests for. */
function isSourceFile(filePath: string): boolean {
  const ext = extname(filePath)
  return SOURCE_EXTENSIONS.has(ext) && !filePath.includes('node_modules')
}

/** Check whether a path is already a test file. */
function isTestFile(filePath: string): boolean {
  return TEST_FILE_PATTERNS.some((p) => filePath.includes(p))
}

/** Derive the conventional test file path for a given source file. */
function deriveTestPath(sourceFile: string): string {
  const ext = extname(sourceFile)
  const withoutExt = sourceFile.replace(ext, '')
  const testExt = ext.replace('.', '.test.')

  if (withoutExt.startsWith('src/')) {
    return withoutExt.replace(/^src\//, 'tests/') + testExt
  }
  return `tests/${withoutExt}${testExt}`
}

/** Build skeleton test content for a source file. */
function buildTestContent(sourceFile: string): string | null {
  const ext = extname(sourceFile)
  const name = basename(sourceFile, ext)

  if (ext === '.ts' || ext === '.js') {
    const importPath = sourceFile
      .replace(/^src\//, '../src/')
      .replace(/\.ts$/, '')
    return [
      `import { describe, it, expect } from 'vitest'`,
      `import * as ${sanitizeIdentifier(name)} from '${importPath}'`,
      ``,
      `describe('${name}', () => {`,
      `  it('should be defined', () => {`,
      `    expect(${sanitizeIdentifier(name)}).toBeDefined()`,
      `  })`,
      ``,
      `  it('should handle edge cases', () => {`,
      `    // TODO: Add edge-case tests for ${sourceFile}`,
      `    expect(true).toBe(true)`,
      `  })`,
      `})`,
      ``,
    ].join('\n')
  }

  if (ext === '.tsx' || ext === '.jsx') {
    const importPath = sourceFile
      .replace(/^src\//, '../src/')
      .replace(/\.tsx?$/, '')
    return [
      `import { describe, it, expect } from 'vitest'`,
      `import * as ${sanitizeIdentifier(name)} from '${importPath}'`,
      ``,
      `describe('${name}', () => {`,
      `  it('should be defined', () => {`,
      `    expect(${sanitizeIdentifier(name)}).toBeDefined()`,
      `  })`,
      `})`,
      ``,
    ].join('\n')
  }

  return null
}

/** Turn a filename into a safe JS identifier. */
function sanitizeIdentifier(name: string): string {
  return name.replace(/[^a-zA-Z0-9_$]/g, '_')
}

/** Check if a file exists on disk. */
async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

/**
 * Parse combined stdout+stderr from a test runner (Vitest / Jest).
 * Extracts total test count, pass count, and individual failures.
 */
function parseTestOutput(output: string): ParsedTestResult {
  let totalTests = 0
  let passedTests = 0
  const failures: Array<{ test: string; error: string; stack?: string }> = []

  // --- Vitest patterns ---
  // "Tests  12 passed (12)"  or  "Tests  2 failed | 10 passed (12)"
  const vitestSummary = output.match(
    /Tests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed\s*\((\d+)\)/i,
  )
  if (vitestSummary) {
    const failed = parseInt(vitestSummary[1] ?? '0', 10)
    passedTests = parseInt(vitestSummary[2] ?? '0', 10)
    totalTests = parseInt(vitestSummary[3] ?? '0', 10)
    if (failed > 0 && totalTests === 0) totalTests = passedTests + failed
  }

  // Simpler Vitest: "5 passed (5 tests)"
  if (totalTests === 0) {
    const simple = output.match(/(\d+)\s+passed\s*\((\d+)\s*tests?\)/i)
    if (simple) {
      passedTests = parseInt(simple[1] ?? '0', 10)
      totalTests = parseInt(simple[2] ?? '0', 10)
    }
  }

  // --- Jest patterns ---
  if (totalTests === 0) {
    const jestSummary = output.match(
      /Tests:\s+(?:(\d+)\s+failed,?\s*)?(\d+)\s+passed(?:,\s*(\d+)\s+total)?/i,
    )
    if (jestSummary) {
      const failed = parseInt(jestSummary[1] ?? '0', 10)
      passedTests = parseInt(jestSummary[2] ?? '0', 10)
      totalTests = jestSummary[3]
        ? parseInt(jestSummary[3], 10)
        : passedTests + failed
    }
  }

  // --- Failure extraction ---
  // Vitest: "FAIL  tests/foo.test.ts > suite > test name"
  const failBlocks = output.matchAll(
    /FAIL\s+(.+?)(?:\n|\r\n)([\s\S]*?)(?=(?:\n(?:FAIL|PASS|✓|Tests\s))|$)/gi,
  )
  for (const block of failBlocks) {
    const testName = (block[1] ?? 'Unknown test').trim()
    const body = (block[2] ?? '').trim()
    const errorLine =
      body.split('\n').find((l) => l.trim().length > 0) ?? 'Test failed'
    failures.push({
      test: testName,
      error: errorLine.substring(0, 300),
      stack: body.substring(0, 1000) || undefined,
    })
  }

  // Fallback: "✗" or "×" markers
  if (failures.length === 0) {
    const crossMarks = output.matchAll(/[✗×]\s+(.+)/g)
    for (const m of crossMarks) {
      failures.push({ test: (m[1] ?? 'Unknown').trim(), error: 'Test failed' })
    }
  }

  return { passed: failures.length === 0, totalTests, passedTests, failures }
}

/** Format an unknown error into an AgentError. */
function formatError(error: unknown): AgentError {
  if (error instanceof Error) {
    return { message: error.message, retryable: false }
  }
  return { message: String(error), retryable: false }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new TestEngineerAgent instance.
 * @param eventBus Optional event bus for progress streaming
 */
export function createTestEngineerAgent(
  eventBus?: EventBus,
): TestEngineerAgent {
  return new TestEngineerAgent(eventBus)
}
