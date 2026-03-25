/**
 * Property tests for Test Engineer Agent
 *
 * Property 23: Test generation covers all modified files
 * Property 24: TestReport conforms to schema
 *
 * Validates: Requirements 13.1, 13.4
 */

import { test, fc } from '@fast-check/vitest'
import { describe, expect, beforeEach, afterEach, it } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createTestEngineerAgent } from '@/agents/test-engineer'
import type {
  AgentContext,
  ImplementationResult,
  TestReport,
  SteeringFiles,
} from '@/core/types'
import type { KASOConfig } from '@/config/schema'

// =============================================================================
// Shared helpers
// =============================================================================

const MOCK_CONFIG: KASOConfig = {
  executorBackends: [],
  defaultBackend: 'test',
  backendSelectionStrategy: 'default',
  maxConcurrentAgents: 1,
  maxPhaseRetries: 2,
  defaultPhaseTimeout: 300,
  phaseTimeouts: {},
  phaseBackends: {},
  contextCapping: {
    enabled: true,
    charsPerToken: 4,
    relevanceRanking: [],
  },
  uiBaseline: {
    baselineDir: '.kiro/ui-baselines',
    captureOnPass: true,
    diffThreshold: 0.1,
    viewport: { width: 1280, height: 720 },
  },
  executionStore: {
    type: 'sqlite',
    path: '.kaso/execution-store.db',
  },
  reviewCouncil: {
    maxReviewRounds: 2,
    enableParallelReview: true,
    perspectives: ['security', 'performance', 'maintainability'],
  },
  webhooks: [],
  mcpServers: [],
  plugins: [],
  customPhases: [],
}

const MOCK_STEERING: SteeringFiles = { hooks: {} }

function buildContext(tempDir: string, modifiedFiles: string[]): AgentContext {
  const impl: ImplementationResult = {
    modifiedFiles,
    addedTests: [],
    duration: 1000,
    backend: 'test',
    selfCorrectionAttempts: 0,
  }

  return {
    runId: 'prop-test-run',
    spec: {
      featureName: 'prop-test',
      specPath: '/test/spec',
      missingFiles: [],
    },
    steering: MOCK_STEERING,
    phaseOutputs: { implementation: impl },
    config: MOCK_CONFIG,
    worktreePath: tempDir,
    backends: {},
  }
}

/** Create a temp dir with a package.json that has a passing test script. */
async function setupWorktree(): Promise<string> {
  const dir = join(
    tmpdir(),
    `kaso-te-prop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  )
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(
    join(dir, 'package.json'),
    JSON.stringify({
      name: 'prop-test',
      scripts: { test: 'echo "Tests passed"' },
    }),
  )
  return dir
}

async function cleanupWorktree(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true })
  } catch {
    /* ignore */
  }
}

// fast-check arbitrary: generates valid source file paths under src/
const sourceFileArb = fc
  .tuple(
    fc.constantFrom(
      'alpha',
      'beta',
      'gamma',
      'delta',
      'epsilon',
      'zeta',
      'eta',
      'theta',
    ),
    fc.constantFrom('.ts', '.js', '.tsx', '.jsx'),
  )
  .map(([name, ext]) => `src/${name}${ext}`)

// fast-check arbitrary: generates non-source file paths
const nonSourceFileArb = fc
  .tuple(
    fc.constantFrom('readme', 'config', 'data', 'styles', 'schema', 'notes'),
    fc.constantFrom('.md', '.json', '.css', '.html', '.yaml', '.png'),
  )
  .map(([name, ext]) => `${name}${ext}`)

// =============================================================================
// Property 23: Test generation covers all modified files
// =============================================================================

describe('Property 23: Test generation covers all modified files', () => {
  /**
   * For any set of modified source files, the test engineer SHALL generate
   * corresponding test files for files without existing tests.
   *
   * Validates: Requirements 13.1
   */

  test.prop([fc.uniqueArray(sourceFileArb, { minLength: 1, maxLength: 5 })], {
    numRuns: 10,
  })(
    'generates tests for every source file without an existing test',
    async (files) => {
      // Each case gets its own temp dir to avoid cross-contamination between runs
      const caseDir = await setupWorktree()
      try {
        // Create the source files on disk so the agent can find them
        for (const file of files) {
          const fullPath = join(caseDir, file)
          const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
          await fs.mkdir(dir, { recursive: true })
          await fs.writeFile(fullPath, 'export const x = 1')
        }

        const agent = createTestEngineerAgent()
        const context = buildContext(caseDir, files)
        const result = await agent.execute(context)

        expect(result.output).toBeDefined()
        const report = result.output as TestReport
        expect(Array.isArray(report.generatedTests)).toBe(true)

        // Every source file should have a generated test (none had pre-existing tests)
        for (const file of files) {
          const expectedTestPath = file
            .replace(/^src\//, 'tests/')
            .replace(/\.([tj]sx?)$/, '.test.$1')

          expect(
            report.generatedTests,
            `Expected generated test for ${file} at ${expectedTestPath}`,
          ).toContainEqual(expectedTestPath)
        }
      } finally {
        await cleanupWorktree(caseDir)
      }
    },
    30_000,
  )

  test.prop(
    [fc.uniqueArray(nonSourceFileArb, { minLength: 1, maxLength: 5 })],
    { numRuns: 10 },
  )(
    'skips non-source files during test generation',
    async (files) => {
      const caseDir = await setupWorktree()
      try {
        const agent = createTestEngineerAgent()
        const context = buildContext(caseDir, files)
        const result = await agent.execute(context)

        const report = result.output as TestReport
        expect((report.generatedTests ?? []).length).toBe(0)
      } finally {
        await cleanupWorktree(caseDir)
      }
    },
    10_000,
  )

  it('does not regenerate tests when test files already exist', async () => {
    const caseDir = await setupWorktree()
    try {
      const sourceFile = 'src/utils.ts'
      const testFile = 'tests/utils.test.ts'

      await fs.mkdir(join(caseDir, 'src'), { recursive: true })
      await fs.mkdir(join(caseDir, 'tests'), { recursive: true })
      await fs.writeFile(join(caseDir, sourceFile), 'export const x = 1')
      await fs.writeFile(join(caseDir, testFile), 'describe("utils", () => {})')

      const agent = createTestEngineerAgent()
      const context = buildContext(caseDir, [sourceFile])
      const result = await agent.execute(context)

      const report = result.output as TestReport
      expect((report.generatedTests ?? []).length).toBe(0)
    } finally {
      await cleanupWorktree(caseDir)
    }
  }, 10_000)

  it('skips test files in the modified list', async () => {
    const caseDir = await setupWorktree()
    try {
      const agent = createTestEngineerAgent()
      const context = buildContext(caseDir, [
        'src/foo.test.ts',
        'src/bar.spec.js',
        'tests/__tests__/baz.ts',
      ])
      const result = await agent.execute(context)

      const report = result.output as TestReport
      expect((report.generatedTests ?? []).length).toBe(0)
    } finally {
      await cleanupWorktree(caseDir)
    }
  }, 10_000)
})

// =============================================================================
// Property 24: TestReport conforms to schema
// =============================================================================

describe('Property 24: TestReport conforms to schema', () => {
  /**
   * For any test execution, the produced TestReport SHALL contain all required
   * fields with valid types and value ranges.
   *
   * Validates: Requirements 13.4
   */

  test.prop([fc.uniqueArray(sourceFileArb, { minLength: 0, maxLength: 4 })], {
    numRuns: 10,
  })(
    'TestReport has all required fields with valid types',
    async (files) => {
      const caseDir = await setupWorktree()
      try {
        // Create source files on disk
        for (const file of files) {
          const fullPath = join(caseDir, file)
          const dir = fullPath.substring(0, fullPath.lastIndexOf('/'))
          await fs.mkdir(dir, { recursive: true })
          await fs.writeFile(fullPath, 'export const x = 1')
        }

        const agent = createTestEngineerAgent()
        const context = buildContext(caseDir, files)
        const result = await agent.execute(context)

        // AgentResult invariants
        expect(typeof result.success).toBe('boolean')
        expect(typeof result.duration).toBe('number')
        expect(result.duration).toBeGreaterThanOrEqual(0)

        // TestReport must be present
        expect(result.output).toBeDefined()
        const report = result.output as TestReport

        // Required fields — types
        expect(typeof report.passed).toBe('boolean')
        expect(typeof report.testsRun).toBe('number')
        expect(typeof report.coverage).toBe('number')
        expect(typeof report.duration).toBe('number')
        expect(Array.isArray(report.testFailures)).toBe(true)

        // Required fields — value ranges
        expect(report.testsRun).toBeGreaterThanOrEqual(0)
        expect(report.coverage).toBeGreaterThanOrEqual(0)
        expect(report.coverage).toBeLessThanOrEqual(100)
        expect(report.duration).toBeGreaterThanOrEqual(0)

        // Each failure entry must have test and error strings
        for (const failure of report.testFailures) {
          expect(typeof failure.test).toBe('string')
          expect(typeof failure.error).toBe('string')
          if (failure.stack !== undefined) {
            expect(typeof failure.stack).toBe('string')
          }
        }

        // Optional generatedTests must be an array of strings if present
        if (report.generatedTests !== undefined) {
          expect(Array.isArray(report.generatedTests)).toBe(true)
          for (const path of report.generatedTests) {
            expect(typeof path).toBe('string')
          }
        }
      } finally {
        await cleanupWorktree(caseDir)
      }
    },
    30_000,
  )

  it('produces valid TestReport even with empty modified files', async () => {
    const caseDir = await setupWorktree()
    try {
      const agent = createTestEngineerAgent()
      const context = buildContext(caseDir, [])
      const result = await agent.execute(context)

      expect(result.output).toBeDefined()
      const report = result.output as TestReport

      expect(typeof report.passed).toBe('boolean')
      expect(report.testsRun).toBeGreaterThanOrEqual(0)
      expect(report.coverage).toBeGreaterThanOrEqual(0)
      expect(report.coverage).toBeLessThanOrEqual(100)
      expect(Array.isArray(report.testFailures)).toBe(true)
      expect((report.generatedTests ?? []).length).toBe(0)
    } finally {
      await cleanupWorktree(caseDir)
    }
  }, 10_000)

  it('returns error result (not crash) when context is invalid', async () => {
    const agent = createTestEngineerAgent()

    // Missing worktreePath
    const badContext: AgentContext = {
      runId: 'bad-run',
      spec: { featureName: 'x', specPath: '/x', missingFiles: [] },
      steering: MOCK_STEERING,
      phaseOutputs: {
        implementation: {
          modifiedFiles: [],
          addedTests: [],
          duration: 0,
          backend: 'x',
          selfCorrectionAttempts: 0,
        },
      },
      config: MOCK_CONFIG,
      backends: {},
    }

    const result = await agent.execute(badContext)
    expect(result.success).toBe(false)
    expect(result.error).toBeDefined()
    expect(typeof result.error!.message).toBe('string')
    expect(typeof result.duration).toBe('number')
  })
})

// =============================================================================
// Additional robustness properties
// =============================================================================

describe('Additional Test Engineer Properties', () => {
  let tempDir: string

  beforeEach(async () => {
    tempDir = await setupWorktree()
  })
  afterEach(async () => {
    await cleanupWorktree(tempDir)
  })

  test.prop([
    fc.record({
      supportsRollback: fc.constant(true),
      estimatedDuration: fc.constant(45_000),
    }),
  ])('agent interface properties are consistent across invocations', () => {
    const agent = createTestEngineerAgent()

    expect(agent.supportsRollback()).toBe(true)
    expect(agent.estimatedDuration()).toBe(45_000)
    expect(agent.requiredContext()).toContain('phaseOutputs.implementation')
    expect(agent.requiredContext()).toContain('worktreePath')
  })

  it('respects abort signal and returns non-success', async () => {
    const controller = new AbortController()
    controller.abort()

    const context = buildContext(tempDir, ['src/foo.ts'])
    context.abortSignal = controller.signal

    const agent = createTestEngineerAgent()
    const result = await agent.execute(context)

    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('aborted')
  })

  it('returns error when implementation result is missing', async () => {
    const context: AgentContext = {
      runId: 'no-impl',
      spec: { featureName: 'x', specPath: '/x', missingFiles: [] },
      steering: MOCK_STEERING,
      phaseOutputs: {},
      config: MOCK_CONFIG,
      worktreePath: tempDir,
      backends: {},
    }

    const agent = createTestEngineerAgent()
    const result = await agent.execute(context)

    expect(result.success).toBe(false)
    expect(result.error?.message).toContain('implementation')
  })
})
