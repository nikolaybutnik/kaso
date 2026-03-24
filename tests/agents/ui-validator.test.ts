/**
 * Unit tests for UI Validator Agent
 *
 * Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7, 14.8
 *
 * Property tests live in tests/property/ui-validator.property.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  UIValidatorAgent,
  createUIValidatorAgent,
  ScreenshotInfo,
} from '../../src/agents/ui-validator'
import type {
  AgentContext,
  ImplementationResult,
  UIReview,
  ParsedSpec,
} from '../../src/core/types'
import { EventBus } from '../../src/core/event-bus'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

// =============================================================================
// Test Fixtures
// =============================================================================

async function createTempDir(): Promise<string> {
  const timestamp = Date.now()
  const random = Math.random().toString(36).substring(7)
  const dir = join(tmpdir(), `kaso-ui-test-${timestamp}-${random}`)
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
    runId: 'test-run-123',
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
// Unit Tests
// =============================================================================

describe('UIValidatorAgent', () => {
  let agent: UIValidatorAgent
  let eventBus: EventBus
  let tempDir: string

  beforeEach(async () => {
    eventBus = new EventBus()
    agent = createUIValidatorAgent({ eventBus })
    tempDir = await createTempDir()
  })

  afterEach(async () => {
    await cleanupDir(tempDir)
  })

  describe('interface compliance', () => {
    it('should implement Agent interface', () => {
      expect(agent.execute).toBeDefined()
      expect(agent.supportsRollback).toBeDefined()
      expect(agent.estimatedDuration).toBeDefined()
      expect(agent.requiredContext).toBeDefined()
    })

    it('should not support rollback', () => {
      expect(agent.supportsRollback()).toBe(false)
    })

    it('should return estimated duration', () => {
      expect(agent.estimatedDuration()).toBeGreaterThan(0)
    })

    it('should require correct context keys', () => {
      const required = agent.requiredContext()
      expect(required).toContain('worktreePath')
      expect(required).toContain('spec')
      expect(required).toContain('phaseOutputs.implementation')
    })
  })

  describe('execution', () => {
    it('should return successful result with UIReview', async () => {
      const context = createMockContext({}, tempDir)
      const result = await agent.execute(context)

      expect(result.success).toBe(true)
      expect(result.output).toBeDefined()

      const uiReview = result.output as UIReview
      expect(uiReview.approved).toBeDefined()
      expect(uiReview.screenshots).toBeDefined()
      expect(uiReview.uiIssues).toBeDefined()
    })

    it('should handle missing worktree path', async () => {
      const context = createMockContext({ worktreePath: undefined })
      const result = await agent.execute(context)

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('worktree')
    })

    it('should handle missing implementation result', async () => {
      const context = createMockContext(
        { phaseOutputs: {}, worktreePath: tempDir },
        tempDir,
      )
      const result = await agent.execute(context)

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('implementation')
    })

    it('should handle abort signal', async () => {
      const abortController = new AbortController()
      abortController.abort()

      const context = createMockContext(
        { abortSignal: abortController.signal },
        tempDir,
      )
      const result = await agent.execute(context)

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('aborted')
    })

    it('should emit progress events', async () => {
      const events: string[] = []
      eventBus.on('agent:progress', (event) => {
        if (event.agent === 'ui-validator') {
          events.push(event.data?.message as string)
        }
      })

      const context = createMockContext({}, tempDir)
      await agent.execute(context)

      expect(events.length).toBeGreaterThan(0)
    })
  })

  describe('UI detection', () => {
    it('should detect UI files by extension', () => {
      const uiFiles = [
        'src/components/Button.tsx',
        'src/pages/index.jsx',
        'src/styles/main.css',
        'src/App.vue',
        'src/lib.svelte',
      ]

      const spec: ParsedSpec = {
        featureName: 'test',
        specPath: '',
        missingFiles: [],
      }

      for (const file of uiFiles) {
        expect(agent.isUISpec([file], spec)).toBe(true)
      }
    })

    it('should detect UI by spec content', () => {
      const nonUIFiles = ['src/utils/helper.ts']

      const spec: ParsedSpec = {
        featureName: 'test',
        specPath: '',
        missingFiles: [],
        design: {
          rawContent: 'This is a UI design with components and layout',
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
      }

      expect(agent.isUISpec(nonUIFiles, spec)).toBe(true)
    })

    it('should not detect non-UI specs', () => {
      const nonUIFiles = ['src/utils/helper.ts', 'src/api/client.ts']

      const spec: ParsedSpec = {
        featureName: 'test',
        specPath: '',
        missingFiles: [],
        design: {
          rawContent: 'Backend API documentation',
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
      }

      expect(agent.isUISpec(nonUIFiles, spec)).toBe(false)
    })
  })

  describe('route identification', () => {
    it('should extract routes from Next.js pages', () => {
      const files = [
        'pages/index.tsx',
        'pages/about.tsx',
        'pages/blog/[slug].tsx',
      ]
      const spec: ParsedSpec = {
        featureName: 'test',
        specPath: '',
        missingFiles: [],
      }

      const routes = agent.identifyRoutes(files, spec)

      expect(routes).toContain('/')
      expect(routes).toContain('/about')
      expect(routes).toContain('/blog/:slug')
    })

    it('should extract routes from app directory', () => {
      const files = [
        'app/page.tsx',
        'app/about/page.tsx',
        'app/blog/[id]/page.tsx',
      ]
      const spec: ParsedSpec = {
        featureName: 'test',
        specPath: '',
        missingFiles: [],
      }

      const routes = agent.identifyRoutes(files, spec)

      expect(routes).toContain('/')
      expect(routes).toContain('/about')
      expect(routes).toContain('/blog/:id')
    })

    it('should extract routes from spec content', () => {
      const files: string[] = []
      const spec: ParsedSpec = {
        featureName: 'test',
        specPath: '',
        missingFiles: [],
        design: {
          rawContent: 'Routes: /dashboard, /settings, /profile',
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
      }

      const routes = agent.identifyRoutes(files, spec)

      expect(routes).toContain('/dashboard')
      expect(routes).toContain('/settings')
      expect(routes).toContain('/profile')
    })

    it('should return default route when no routes found', () => {
      const files: string[] = []
      const spec: ParsedSpec = {
        featureName: 'test',
        specPath: '',
        missingFiles: [],
      }

      const routes = agent.identifyRoutes(files, spec)

      expect(routes).toEqual(['/'])
    })
  })

  describe('UI phase skipping', () => {
    it('should skip phase for non-UI specs', async () => {
      const context = createMockContext(
        {
          phaseOutputs: {
            implementation: {
              modifiedFiles: ['src/utils/helper.ts', 'src/api/client.ts'],
              addedTests: [],
              duration: 1000,
              backend: 'kimi-code',
              selfCorrectionAttempts: 0,
            } as ImplementationResult,
          },
          spec: {
            featureName: 'backend-api',
            specPath: '/test/specs/backend',
            design: {
              rawContent: 'Backend API documentation',
              sections: [],
              codeBlocks: [],
              metadata: {},
            },
            missingFiles: [],
          },
        },
        tempDir,
      )

      const result = await agent.execute(context)
      expect(result.success).toBe(true)

      const uiReview = result.output as UIReview
      expect(uiReview.skipped).toBe(true)
      expect(uiReview.approved).toBe(true)
      expect(uiReview.screenshots).toHaveLength(0)
    })

    it('should use default route when only components modified', async () => {
      const context = createMockContext(
        {
          phaseOutputs: {
            implementation: {
              modifiedFiles: ['src/components/Button.tsx'],
              addedTests: [],
              duration: 1000,
              backend: 'kimi-code',
              selfCorrectionAttempts: 0,
            } as ImplementationResult,
          },
          spec: {
            featureName: 'component-lib',
            specPath: '/test/specs/components',
            missingFiles: [],
          },
        },
        tempDir,
      )

      const result = await agent.execute(context)
      expect(result.success).toBe(true)

      // Components ARE UI components, so phase should proceed with default route
      const uiReview = result.output as UIReview
      expect(uiReview.skipped).toBe(false)
    })
  })

  describe('baseline management', () => {
    it('should create baseline directory structure', async () => {
      const context = createMockContext({}, tempDir)
      await agent.execute(context)

      const baselineDir = join(tempDir, '.kiro', 'ui-baselines')
      const stats = await fs.stat(baselineDir)
      expect(stats.isDirectory()).toBe(true)
    })

    it('should create new baselines when none exist', async () => {
      const context = createMockContext({}, tempDir)
      const result = await agent.execute(context)

      expect(result.success).toBe(true)

      const uiReview = result.output as UIReview
      const hasNewBaselines = uiReview.screenshots.some((s) => s.baseline)
      expect(hasNewBaselines).toBe(true)
    })

    it('should update baselines on developer approval (Req 14.5)', async () => {
      const baselineDir = join(tempDir, '.kiro', 'ui-baselines')
      await fs.mkdir(baselineDir, { recursive: true })

      // Create a "current" screenshot file
      const currentPath = join(baselineDir, 'current', '_dashboard.png')
      await fs.mkdir(join(baselineDir, 'current'), { recursive: true })
      await fs.writeFile(currentPath, Buffer.from('new-screenshot-data'))

      // Create an old baseline
      const oldBaselinePath = join(baselineDir, '_dashboard.png')
      await fs.writeFile(oldBaselinePath, Buffer.from('old-baseline-data'))

      const screenshots: ScreenshotInfo[] = [
        {
          route: '/dashboard',
          path: currentPath,
          baseline: oldBaselinePath,
          diff: join(baselineDir, 'diff', '_dashboard.png'),
          diffPercentage: 5.0,
        },
      ]

      const updated = await agent.updateBaselines(screenshots, baselineDir)

      expect(updated).toEqual(['/dashboard'])
      // Baseline should now contain the new screenshot data
      const baselineContent = await fs.readFile(oldBaselinePath)
      expect(baselineContent.toString()).toBe('new-screenshot-data')
      // Diff should be cleared on the screenshot info
      expect(screenshots[0]!.diff).toBeUndefined()
      expect(screenshots[0]!.diffPercentage).toBeUndefined()
    })
  })
})

// =============================================================================
// Edge Cases
// =============================================================================

describe('UI Validator Edge Cases', () => {
  it('should handle empty modified files list', async () => {
    const testAgent = createUIValidatorAgent()
    const testDir = await createTempDir()

    try {
      const context = createMockContext(
        {
          worktreePath: testDir,
          phaseOutputs: {
            implementation: {
              modifiedFiles: [],
              addedTests: [],
              duration: 0,
              backend: 'kimi-code',
              selfCorrectionAttempts: 0,
            } as ImplementationResult,
          },
        },
        testDir,
      )

      const result = await testAgent.execute(context)

      // Should either skip or succeed with empty results
      expect(result.success).toBe(true)
    } finally {
      await cleanupDir(testDir)
    }
  })

  it('should handle special characters in route names', () => {
    const testAgent = createUIValidatorAgent()
    const spec: ParsedSpec = {
      featureName: 'test',
      specPath: '',
      missingFiles: [],
    }

    const routes = [
      '/path-with-dashes',
      '/path_with_underscores',
      '/path123',
      '/mixed-Path_123',
    ]

    for (const route of routes) {
      const identified = testAgent.identifyRoutes([`pages${route}.tsx`], spec)
      expect(identified.length).toBeGreaterThan(0)
    }
  })

  it('should handle dynamic routes', () => {
    const testAgent = createUIValidatorAgent()
    const spec: ParsedSpec = {
      featureName: 'test',
      specPath: '',
      missingFiles: [],
    }

    const dynamicRoutes = [
      { file: 'pages/blog/[slug].tsx', expected: '/blog/:slug' },
      { file: 'pages/users/[id].tsx', expected: '/users/:id' },
      { file: 'app/posts/[postId]/page.tsx', expected: '/posts/:postId' },
    ]

    for (const { file, expected } of dynamicRoutes) {
      const routes = testAgent.identifyRoutes([file], spec)
      expect(routes).toContain(expected)
    }
  })
})
