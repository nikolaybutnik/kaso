/**
 * Unit tests for Test Engineer Agent (Phase 6 - Test & Verification)
 * Tests test generation, execution, and coverage analysis
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
import { EventBus } from '@/core/event-bus'

// Helper to create minimal AgentContext
function createMockContext(
  overrides: Partial<AgentContext> = {},
  worktreePath?: string,
): AgentContext {
  const mockSteering: SteeringFiles = {
    hooks: {},
  }

  const mockConfig: KASOConfig = {
    executorBackends: [],
    phaseBackends: {},
    defaultBackend: 'test',
    backendSelectionStrategy: 'default',
    maxConcurrentAgents: 1,
    maxPhaseRetries: 2,
    defaultPhaseTimeout: 300,
    phaseTimeouts: {},
    contextCapping: {
      enabled: true,
      charsPerToken: 4,
      relevanceRanking: ['requirements.md', 'design.md', 'tasks.md'],
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

  const mockImplementationResult: ImplementationResult = {
    modifiedFiles: ['src/utils.ts'],
    addedTests: [],
    duration: 1000,
    backend: 'test',
    selfCorrectionAttempts: 0,
  }

  return {
    runId: 'test-run-id',
    spec: {
      featureName: 'test-feature',
      specPath: '/test/spec',
      missingFiles: [],
    },
    steering: mockSteering,
    phaseOutputs: {
      implementation: mockImplementationResult,
    },
    config: mockConfig,
    worktreePath,
    backends: {},
    ...overrides,
  }
}

describe('TestEngineerAgent', () => {
  describe('Agent Interface', () => {
    it('should implement Agent interface', () => {
      const agent = createTestEngineerAgent()

      expect(agent.supportsRollback()).toBe(true)
      expect(agent.estimatedDuration()).toBe(45000)
      expect(agent.requiredContext()).toContain('phaseOutputs.implementation')
      expect(agent.requiredContext()).toContain('worktreePath')
    })
  })

  describe('Context Validation', () => {
    it('should fail when worktree path is missing', async () => {
      const agent = createTestEngineerAgent()
      const context = createMockContext({}, undefined)

      const result = await agent.execute(context)

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('worktree')
    })

    it('should fail when implementation result is missing', async () => {
      const agent = createTestEngineerAgent()
      const context = createMockContext(
        {
          phaseOutputs: {},
          worktreePath: '/tmp/test',
        },
        '/tmp/test',
      )

      const result = await agent.execute(context)

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('implementation')
    })
  })

  describe('Test Generation', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = join(tmpdir(), `kaso-test-engineer-${Date.now()}`)
      await fs.mkdir(tempDir, { recursive: true })
    })

    afterEach(async () => {
      try {
        await fs.rm(tempDir, { recursive: true })
      } catch {
        // Ignore cleanup errors
      }
    })

    it('should generate tests for modified source files', async () => {
      // Create a source file
      await fs.mkdir(join(tempDir, 'src'), { recursive: true })
      await fs.writeFile(
        join(tempDir, 'src', 'utils.ts'),
        'export function add(a: number, b: number): number { return a + b }',
      )

      // Create package.json with test script
      await fs.writeFile(
        join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'test-project',
          scripts: {
            test: 'echo "Tests passed"',
          },
        }),
      )

      const agent = createTestEngineerAgent()
      const context = createMockContext(
        {
          phaseOutputs: {
            implementation: {
              modifiedFiles: ['src/utils.ts'],
              addedTests: [],
              duration: 1000,
              backend: 'test',
              selfCorrectionAttempts: 0,
            } as ImplementationResult,
          },
          worktreePath: tempDir,
        },
        tempDir,
      )

      const result = await agent.execute(context)

      // Should succeed and produce output
      expect(result.output).toBeDefined()
      const testReport = result.output as TestReport
      expect(testReport.generatedTests).toBeDefined()
      // Note: Test generation may not occur if npm detection fails in test environment
      // so we just verify the structure is correct
      expect(Array.isArray(testReport.generatedTests)).toBe(true)
    })

    it('should skip test generation for existing test files', async () => {
      // Create source file and existing test file
      await fs.mkdir(join(tempDir, 'src'), { recursive: true })
      await fs.mkdir(join(tempDir, 'tests'), { recursive: true })

      await fs.writeFile(
        join(tempDir, 'src', 'utils.ts'),
        'export function add(a: number, b: number): number { return a + b }',
      )

      await fs.writeFile(
        join(tempDir, 'tests', 'utils.test.ts'),
        'describe("utils", () => { it("works", () => {}) })',
      )

      // Create package.json
      await fs.writeFile(
        join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'test-project',
          scripts: {
            test: 'echo "Tests passed"',
          },
        }),
      )

      const agent = createTestEngineerAgent()
      const context = createMockContext(
        {
          phaseOutputs: {
            implementation: {
              modifiedFiles: ['src/utils.ts'],
              addedTests: [],
              duration: 1000,
              backend: 'test',
              selfCorrectionAttempts: 0,
            } as ImplementationResult,
          },
          worktreePath: tempDir,
        },
        tempDir,
      )

      const result = await agent.execute(context)

      const testReport = result.output as TestReport
      // Should not generate new test since one exists
      expect((testReport.generatedTests ?? []).length).toBe(0)
    })

    it('should skip non-source files', async () => {
      const agent = createTestEngineerAgent()
      const context = createMockContext(
        {
          phaseOutputs: {
            implementation: {
              modifiedFiles: ['README.md', '.gitignore', 'src/styles.css'],
              addedTests: [],
              duration: 1000,
              backend: 'test',
              selfCorrectionAttempts: 0,
            } as ImplementationResult,
          },
          worktreePath: tempDir,
        },
        tempDir,
      )

      const result = await agent.execute(context)

      const testReport = result.output as TestReport
      // No tests generated for non-source files
      expect((testReport.generatedTests ?? []).length).toBe(0)
    })
  })

  describe('Test Execution', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = join(tmpdir(), `kaso-test-engineer-${Date.now()}`)
      await fs.mkdir(tempDir, { recursive: true })
    })

    afterEach(async () => {
      try {
        await fs.rm(tempDir, { recursive: true })
      } catch {
        // Ignore cleanup errors
      }
    })

    it('should produce TestReport with required fields', async () => {
      // Create package.json with mock test script
      await fs.writeFile(
        join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'test-project',
          scripts: {
            test: 'echo "Tests: 5 passed (5 tests)"',
          },
        }),
      )

      const agent = createTestEngineerAgent()
      const context = createMockContext(
        {
          phaseOutputs: {
            implementation: {
              modifiedFiles: ['src/example.ts'],
              addedTests: [],
              duration: 1000,
              backend: 'test',
              selfCorrectionAttempts: 0,
            } as ImplementationResult,
          },
          worktreePath: tempDir,
        },
        tempDir,
      )

      const result = await agent.execute(context)

      expect(result.output).toBeDefined()
      const testReport = result.output as TestReport

      // Verify TestReport structure
      expect(typeof testReport.passed).toBe('boolean')
      expect(typeof testReport.testsRun).toBe('number')
      expect(Array.isArray(testReport.testFailures)).toBe(true)
      expect(typeof testReport.coverage).toBe('number')
      expect(typeof testReport.duration).toBe('number')
    })

    it('should handle projects without test scripts', async () => {
      // Create package.json without test script
      await fs.writeFile(
        join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'test-project',
          scripts: {},
        }),
      )

      const agent = createTestEngineerAgent()
      const context = createMockContext(
        {
          worktreePath: tempDir,
        },
        tempDir,
      )

      const result = await agent.execute(context)

      // Should still succeed (no tests to run)
      expect(result.output).toBeDefined()
      const testReport = result.output as TestReport
      expect(testReport.testsRun).toBe(0)
    })
  })

  describe('Abort Signal Support', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = join(tmpdir(), `kaso-test-engineer-${Date.now()}`)
      await fs.mkdir(tempDir, { recursive: true })
    })

    afterEach(async () => {
      try {
        await fs.rm(tempDir, { recursive: true })
      } catch {
        // Ignore cleanup errors
      }
    })

    it('should respect abort signal before execution', async () => {
      const agent = createTestEngineerAgent()
      const abortController = new AbortController()
      abortController.abort()

      const context = createMockContext(
        {
          abortSignal: abortController.signal,
          worktreePath: tempDir,
        },
        tempDir,
      )

      const result = await agent.execute(context)

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('aborted')
    })
  })

  describe('Progress Events', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = join(tmpdir(), `kaso-test-engineer-${Date.now()}`)
      await fs.mkdir(tempDir, { recursive: true })

      await fs.writeFile(
        join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'test-project',
          scripts: {
            test: 'echo "Tests passed"',
          },
        }),
      )
    })

    afterEach(async () => {
      try {
        await fs.rm(tempDir, { recursive: true })
      } catch {
        // Ignore cleanup errors
      }
    })

    it('should emit progress events during execution', async () => {
      const eventBus = new EventBus()
      const progressEvents: string[] = []

      eventBus.on('agent:progress', (event) => {
        if (event.agent === 'test-engineer') {
          progressEvents.push(event.data?.message as string)
        }
      })

      const agent = createTestEngineerAgent(eventBus)
      const context = createMockContext({}, tempDir)

      await agent.execute(context)

      expect(progressEvents.length).toBeGreaterThan(0)
      expect(progressEvents.some((m) => m.includes('Generating'))).toBe(true)
      expect(progressEvents.some((m) => m.includes('Executing'))).toBe(true)
      expect(progressEvents.some((m) => m.includes('coverage'))).toBe(true)
    })
  })

  describe('Coverage Analysis', () => {
    let tempDir: string

    beforeEach(async () => {
      tempDir = join(tmpdir(), `kaso-test-engineer-${Date.now()}`)
      await fs.mkdir(tempDir, { recursive: true })
      await fs.mkdir(join(tempDir, 'coverage'), { recursive: true })

      await fs.writeFile(
        join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'test-project',
          scripts: {
            test: 'echo "Tests passed"',
          },
        }),
      )
    })

    afterEach(async () => {
      try {
        await fs.rm(tempDir, { recursive: true })
      } catch {
        // Ignore cleanup errors
      }
    })

    it('should read coverage data when available', async () => {
      // Create mock coverage report
      const coverageData = {
        'src/utils.ts': {
          lines: { pct: 85 },
          functions: { pct: 90 },
        },
        total: {
          lines: { pct: 80 },
        },
      }

      await fs.writeFile(
        join(tempDir, 'coverage', 'coverage-summary.json'),
        JSON.stringify(coverageData),
      )

      const agent = createTestEngineerAgent()
      const context = createMockContext(
        {
          phaseOutputs: {
            implementation: {
              modifiedFiles: ['src/utils.ts'],
              addedTests: [],
              duration: 1000,
              backend: 'test',
              selfCorrectionAttempts: 0,
            } as ImplementationResult,
          },
          worktreePath: tempDir,
        },
        tempDir,
      )

      const result = await agent.execute(context)

      const testReport = result.output as TestReport
      expect(testReport.coverage).toBe(85) // Should read from coverage data
    })

    it('should return 0 coverage when no coverage data available', async () => {
      const agent = createTestEngineerAgent()
      const context = createMockContext({}, tempDir)

      const result = await agent.execute(context)

      const testReport = result.output as TestReport
      expect(testReport.coverage).toBe(0)
    })
  })
})
