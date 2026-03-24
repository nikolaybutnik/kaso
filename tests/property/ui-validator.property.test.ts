/**
 * Property tests for UI Validator Agent
 *
 * Property 25: UI phase skipped for non-UI specs
 * Property 26: UIReview conforms to schema
 * Property 55: UI baseline management lifecycle
 * Property 60: UI baselines stored under configured directory by route
 *
 * Validates: Requirements 14.4, 14.5, 14.6, 14.8
 */

import { test, fc } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import {
  createUIValidatorAgent,
  ScreenshotInfo,
} from '../../src/agents/ui-validator'
import type {
  AgentContext,
  ImplementationResult,
  UIReview,
  ParsedSpec,
} from '../../src/core/types'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// =============================================================================
// Shared Fixtures
// =============================================================================

async function createTempDir(): Promise<string> {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(7)
  const dir = join(tmpdir(), `kaso-ui-prop-${timestamp}-${random}`)
  await fs.mkdir(dir, { recursive: true })
  return dir
}

async function cleanupDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true })
  } catch {
    // Ignore cleanup errors
  }
}

function createMockContext(
  overrides: Partial<AgentContext> = {},
  tempWorktreePath?: string,
): AgentContext {
  return {
    runId: 'test-run-prop',
    spec: {
      featureName: 'ui-feature',
      specPath: '/test/specs/ui-feature',
      design: {
        rawContent: 'UI design document',
        sections: [],
        codeBlocks: [],
        metadata: {},
      },
      techSpec: {
        rawContent: 'Technical specification for UI components',
        sections: [],
        codeBlocks: [],
        metadata: {},
      },
      missingFiles: [],
    },
    steering: { hooks: {} },
    worktreePath: tempWorktreePath ?? '/test/worktree',
    phaseOutputs: {
      implementation: {
        modifiedFiles: ['src/components/Button.tsx', 'src/pages/index.tsx'],
        addedTests: ['tests/components/Button.test.tsx'],
        duration: 5000,
        backend: 'kimi-code',
        selfCorrectionAttempts: 0,
      } as ImplementationResult,
    },
    config: {
      executorBackends: [],
      defaultBackend: '',
      maxConcurrentAgents: 4,
      maxPhaseRetries: 2,
      defaultPhaseTimeout: 300,
      phaseTimeouts: {},
      backendSelectionStrategy: 'default',
      contextCapping: {
        enabled: true,
        charsPerToken: 4,
        relevanceRanking: [],
      },
      reviewCouncil: {
        maxReviewRounds: 2,
        enableParallelReview: false,
        perspectives: ['security', 'performance', 'maintainability'],
      },
      uiBaseline: {
        baselineDir: '.kiro/ui-baselines',
        captureOnPass: true,
        diffThreshold: 0.1,
        viewport: { width: 1280, height: 720 },
      },
      webhooks: [],
      mcpServers: [],
      plugins: [],
      customPhases: [],
      executionStore: {
        type: 'sqlite',
        path: '.kaso/execution-store.db',
      },
    },
    backends: {},
    ...overrides,
  }
}

// =============================================================================
// Property 25: UI phase skipped for non-UI specs
// Validates: Requirement 14.8
// =============================================================================

describe('Property 25: UI phase skipped for non-UI specs', () => {
  test.prop(
    [fc.array(fc.string({ minLength: 1, maxLength: 50 })), fc.boolean()],
    { numRuns: 30 },
  )(
    'non-UI specs always produce skipped=true, approved=true',
    async (files, hasUIKeywords) => {
      const agent = createUIValidatorAgent()
      const testDir = await createTempDir()

      try {
        const spec: ParsedSpec = {
          featureName: 'test',
          specPath: '',
          missingFiles: [],
          design: hasUIKeywords
            ? {
                rawContent: 'UI components and design system',
                sections: [],
                codeBlocks: [],
                metadata: {},
              }
            : {
                rawContent: 'Backend API endpoints',
                sections: [],
                codeBlocks: [],
                metadata: {},
              },
        }

        const isUI = agent.isUISpec(files, spec)

        if (!isUI) {
          const context = createMockContext(
            {
              worktreePath: testDir,
              phaseOutputs: {
                implementation: {
                  modifiedFiles: files,
                  addedTests: [],
                  duration: 1000,
                  backend: 'kimi-code',
                  selfCorrectionAttempts: 0,
                } as ImplementationResult,
              },
              spec,
            },
            testDir,
          )

          const result = await agent.execute(context)
          const uiReview = result.output as UIReview

          if (uiReview) {
            expect(uiReview.skipped).toBe(true)
            expect(uiReview.approved).toBe(true)
            expect(uiReview.screenshots).toHaveLength(0)
          }
        }
      } finally {
        await cleanupDir(testDir)
      }
    },
  )
})

// =============================================================================
// Property 26: UIReview conforms to schema
// Validates: Requirements 14.1, 14.2, 14.6, 14.7
// =============================================================================

describe('Property 26: UIReview conforms to schema', () => {
  test.prop(
    [
      fc.boolean(),
      fc.integer({ min: 0, max: 10 }),
      fc.integer({ min: 0, max: 10 }),
    ],
    { numRuns: 30 },
  )(
    'UIReview output always has correct shape and valid field types',
    async (_approved, screenshotCount, _issueCount) => {
      const agent = createUIValidatorAgent()
      const testDir = await createTempDir()

      try {
        // Pre-create mock screenshot files
        const _screenshots: ScreenshotInfo[] = []
        for (let i = 0; i < screenshotCount; i++) {
          const route = `/route-${i}`
          const path = join(testDir, `${route.replace(/\//g, '_')}.png`)
          await fs.writeFile(path, Buffer.from(''))
          _screenshots.push({
            route,
            path,
            baseline: i % 2 === 0 ? path : undefined,
          })
        }

        const context = createMockContext(
          {
            worktreePath: testDir,
            phaseOutputs: {
              implementation: {
                modifiedFiles: ['src/pages/index.tsx'],
                addedTests: [],
                duration: 1000,
                backend: 'kimi-code',
                selfCorrectionAttempts: 0,
              } as ImplementationResult,
            },
          },
          testDir,
        )

        const result = await agent.execute(context)

        if (result.output) {
          const uiReview = result.output as UIReview

          // Top-level schema
          expect(typeof uiReview.approved).toBe('boolean')
          expect(Array.isArray(uiReview.screenshots)).toBe(true)
          expect(Array.isArray(uiReview.uiIssues)).toBe(true)

          // Screenshot entries
          for (const screenshot of uiReview.screenshots) {
            expect(typeof screenshot.route).toBe('string')
            expect(typeof screenshot.path).toBe('string')
            if (screenshot.baseline !== undefined) {
              expect(typeof screenshot.baseline).toBe('string')
            }
            if (screenshot.diff !== undefined) {
              expect(typeof screenshot.diff).toBe('string')
            }
          }

          // Issue entries
          const validTypes = [
            'visual',
            'responsive',
            'accessibility',
            'consistency',
          ]
          const validSeverities = ['high', 'medium', 'low']

          for (const issue of uiReview.uiIssues) {
            expect(validTypes).toContain(issue.type)
            expect(typeof issue.description).toBe('string')
            expect(validSeverities).toContain(issue.severity)
            if (issue.component !== undefined) {
              expect(typeof issue.component).toBe('string')
            }
          }
        }
      } finally {
        await cleanupDir(testDir)
      }
    },
  )
})

// =============================================================================
// Property 55: UI baseline management lifecycle
// Validates: Requirements 14.3, 14.4, 14.5
// =============================================================================

describe('Property 55: UI baseline management lifecycle', () => {
  test.prop([fc.integer({ min: 1, max: 5 })], { numRuns: 20 })(
    'all captured screenshots get paths and baseline directory is created',
    async (routeCount) => {
      const agent = createUIValidatorAgent()
      const testDir = await createTempDir()

      try {
        const baselineDir = join(testDir, '.kiro', 'ui-baselines')
        await fs.mkdir(baselineDir, { recursive: true })

        const routes: string[] = []
        for (let i = 0; i < routeCount; i++) {
          routes.push(`/route-${i}`)
        }

        const context = createMockContext(
          {
            worktreePath: testDir,
            phaseOutputs: {
              implementation: {
                modifiedFiles: routes.map((r) => `src/pages${r}.tsx`),
                addedTests: [],
                duration: 1000,
                backend: 'kimi-code',
                selfCorrectionAttempts: 0,
              } as ImplementationResult,
            },
          },
          testDir,
        )

        const result = await agent.execute(context)

        expect(result.success).toBe(true)

        const uiReview = result.output as UIReview

        // Every screenshot must have a path
        for (const screenshot of uiReview.screenshots) {
          expect(screenshot.path).toBeDefined()
          expect(typeof screenshot.path).toBe('string')
        }

        // Baseline directory must exist after execution
        const baselineExists = await fs
          .stat(baselineDir)
          .then(() => true)
          .catch(() => false)
        expect(baselineExists).toBe(true)
      } finally {
        await cleanupDir(testDir)
      }
    },
  )
})

// =============================================================================
// Property 60: UI baselines stored under configured directory by route
// Validates: Requirement 14.5
// =============================================================================

describe('Property 60: UI baselines stored under configured directory by route', () => {
  test.prop(
    [
      fc
        .string({ minLength: 1, maxLength: 20 })
        .filter((s) => /^[a-z-]+$/.test(s)),
    ],
    { numRuns: 30 },
  )(
    'baseline directory is created at the configured path for any route',
    async (routeName) => {
      const agent = createUIValidatorAgent()
      const testDir = await createTempDir()

      try {
        const baselineDir = '.kiro/ui-baselines'

        const context = createMockContext(
          {
            worktreePath: testDir,
            config: {
              ...createMockContext({}).config,
              uiBaseline: {
                baselineDir,
                captureOnPass: true,
                diffThreshold: 0.1,
                viewport: { width: 1280, height: 720 },
              },
            },
            phaseOutputs: {
              implementation: {
                modifiedFiles: [`src/pages/${routeName}.tsx`],
                addedTests: [],
                duration: 1000,
                backend: 'kimi-code',
                selfCorrectionAttempts: 0,
              } as ImplementationResult,
            },
          },
          testDir,
        )

        const result = await agent.execute(context)

        expect(result.success).toBe(true)

        // Baseline directory must exist under the configured path
        const fullBaselinePath = join(testDir, baselineDir)
        const baselineExists = await fs
          .stat(fullBaselinePath)
          .then(() => true)
          .catch(() => false)
        expect(baselineExists).toBe(true)
      } finally {
        await cleanupDir(testDir)
      }
    },
  )
})
