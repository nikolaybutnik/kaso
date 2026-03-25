/**
 * Property-based tests for Architecture Guardian Agent
 * Validates: Requirements 10.3, 12.1
 *
 * Property 18: ADRs are loaded when present
 * Property 22: Architecture review covers all modified files
 */

import { test, fc } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ArchitectureGuardianAgent } from '@/agents/architecture-guardian'
import type {
  AgentContext,
  AssembledContext,
  ImplementationResult,
  ArchitectureContext,
  ArchitectureReview,
  ParsedMarkdown,
  SteeringFiles,
} from '@/core/types'
import type { KASOConfig } from '@/config/schema'

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
    defaultBackend: 'test',
    phaseBackends: {},
    backendSelectionStrategy: 'default',
    maxConcurrentAgents: 1,
    maxPhaseRetries: 2,
    defaultPhaseTimeout: 300,
    phaseTimeouts: {},
    contextCapping: {
      enabled: true,
      charsPerToken: 4,
      relevanceRanking: ['design.md', 'tech-spec.md', 'task.md'],
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

  return {
    runId: 'test-run-id',
    spec: {
      featureName: 'test-feature',
      specPath: '/test/spec',
      missingFiles: [],
    },
    steering: mockSteering,
    phaseOutputs: {},
    config: mockConfig,
    worktreePath,
    backends: {},
    ...overrides,
  }
}

// Helper to create a ParsedMarkdown object
function createMockMarkdown(content: string): ParsedMarkdown {
  return {
    rawContent: content,
    sections: [],
    codeBlocks: [],
    metadata: {},
  }
}

// Helper to create a mock AssembledContext
function createMockAssembledContext(
  designContent = '',
  techSpecContent = '',
): AssembledContext {
  return {
    featureName: 'test-feature',
    designDoc: createMockMarkdown(designContent),
    techSpec: createMockMarkdown(techSpecContent),
    taskList: [],
    architectureDocs: {},
    dependencies: {},
    removedFiles: [],
  }
}

async function createTempDir(prefix: string): Promise<string> {
  const dir = join(
    tmpdir(),
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  await fs.mkdir(dir, { recursive: true })
  return dir
}

async function cleanupTempDir(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true })
  } catch {
    // Ignore cleanup errors
  }
}

describe('Property 18: ADRs are loaded when present', () => {
  /**
   * Property 18: ADRs are loaded when present
   * For any repository containing architectural decision record files,
   * the ArchitectureGuardian_Agent SHALL include those ADRs in the produced ArchitectureContext.
   *
   * Validates: Requirements 10.3
   */

  test.prop([
    fc.array(
      fc.record({
        filename: fc.string({ minLength: 5, maxLength: 30 }).map(
          (s) =>
            // Ensure valid filenames
            s.replace(/[^a-zA-Z0-9-]/g, '') + '.md',
        ),
        title: fc.string({ minLength: 10, maxLength: 100 }),
        status: fc.constantFrom(
          'proposed',
          'accepted',
          'deprecated',
          'superseded',
        ),
        hasDate: fc.boolean(),
      }),
      { minLength: 0, maxLength: 10 },
    ),
  ])('should load all ADRs from docs/adr directory', async (adrs) => {
    // Deduplicate by filename — writing two files with the same name overwrites on disk
    const uniqueAdrs = [...new Map(adrs.map((a) => [a.filename, a])).values()]
    const tempDir = await createTempDir('kaso-adr-test')
    try {
      // Create ADR directory
      const adrDir = join(tempDir, 'docs', 'adr')
      await fs.mkdir(adrDir, { recursive: true })

      // Create each ADR file
      for (const adr of uniqueAdrs) {
        const dateLine = adr.hasDate ? `\nDate: 2024-01-15` : ''
        const content = `# ${adr.title}

## Status

${adr.status}${dateLine}

## Context

Context for the decision.

## Decision

The decision made.

## Consequences

The consequences.
`
        await fs.writeFile(join(adrDir, adr.filename), content)
      }

      const agent = new ArchitectureGuardianAgent('architecture-analysis')
      const assembledContext = createMockAssembledContext()
      const context = createMockContext(
        {
          phaseOutputs: {
            intake: assembledContext,
          },
        },
        tempDir,
      )

      const result = await agent.execute(context)

      expect(result.success).toBe(true)
      const archContext = result.output as ArchitectureContext
      expect(archContext.adrsFound).toBe(uniqueAdrs.length)
      expect(Object.keys(archContext.adrs).length).toBe(uniqueAdrs.length)

      // Verify each ADR is present
      for (const adr of uniqueAdrs) {
        const adrPath = `docs/adr/${adr.filename}`
        expect(archContext.adrs[adrPath]).toBeDefined()
        expect(archContext.adrs[adrPath]?.rawContent).toContain(adr.title)
      }
    } finally {
      await cleanupTempDir(tempDir)
    }
  })

  test.prop([
    fc.array(
      fc.record({
        number: fc.integer({ min: 1, max: 999 }),
        name: fc
          .string({ minLength: 5, maxLength: 30 })
          .map((s) => s.replace(/[^a-zA-Z0-9-]/g, '')),
      }),
      { minLength: 0, maxLength: 10 },
    ),
  ])('should load numbered ADRs from root directory', async (adrs) => {
    const tempDir = await createTempDir('kaso-adr-root-test')
    try {
      // Create numbered ADR files in root
      for (const adr of adrs) {
        const paddedNumber = adr.number.toString().padStart(3, '0')
        const filename = `${paddedNumber}-${adr.name}.md`
        const content = `# ADR ${adr.number}: ${adr.name}

Status: Accepted

## Context

Some context.

## Decision

Some decision.
`
        await fs.writeFile(join(tempDir, filename), content)
      }

      const agent = new ArchitectureGuardianAgent('architecture-analysis')
      const assembledContext = createMockAssembledContext()
      const context = createMockContext(
        {
          phaseOutputs: {
            intake: assembledContext,
          },
        },
        tempDir,
      )

      const result = await agent.execute(context)

      expect(result.success).toBe(true)
      const archContext = result.output as ArchitectureContext

      // Should find the numbered ADRs
      const expectedCount = adrs.length
      expect(archContext.adrsFound).toBe(expectedCount)
    } finally {
      await cleanupTempDir(tempDir)
    }
  })

  test.prop([fc.string({ minLength: 50, maxLength: 500 })])(
    'should preserve ADR content structure',
    async (adrContent) => {
      const tempDir = await createTempDir('kaso-adr-content-test')
      try {
        const adrDir = join(tempDir, 'docs', 'adr')
        await fs.mkdir(adrDir, { recursive: true })

        // Ensure valid ADR structure
        const validAdr = `# ADR Test\n\n${adrContent}`
        await fs.writeFile(join(adrDir, 'test-adr.md'), validAdr)

        const agent = new ArchitectureGuardianAgent('architecture-analysis')
        const assembledContext = createMockAssembledContext()
        const context = createMockContext(
          {
            phaseOutputs: {
              intake: assembledContext,
            },
          },
          tempDir,
        )

        const result = await agent.execute(context)

        expect(result.success).toBe(true)
        const archContext = result.output as ArchitectureContext
        expect(archContext.adrs['docs/adr/test-adr.md']).toBeDefined()
        expect(archContext.adrs['docs/adr/test-adr.md']?.rawContent).toBe(
          validAdr,
        )
      } finally {
        await cleanupTempDir(tempDir)
      }
    },
  )
})

describe('Property 22: Architecture review covers all modified files', () => {
  /**
   * Property 22: Architecture review covers all modified files
   * For any set of files modified during the Implementation phase,
   * the Architecture Review phase SHALL review every file in that set
   * against the ArchitectureContext patterns.
   *
   * Validates: Requirements 12.1
   */

  test.prop([
    fc.array(
      fc.string({ minLength: 5, maxLength: 50 }).map((s) => {
        // Generate valid file paths
        const clean = s.replace(/[^a-zA-Z0-9-/]/g, '').replace(/^\//, '')
        return clean ? `src/${clean}.ts` : 'src/test.ts'
      }),
      { minLength: 0, maxLength: 20 },
    ),
  ])('should review all provided modified files', async (filePaths) => {
    const tempDir = await createTempDir('kaso-review-test')
    try {
      // Create the files
      await fs.mkdir(join(tempDir, 'src'), { recursive: true })
      for (const filePath of filePaths) {
        const fullPath = join(tempDir, filePath)
        await fs.mkdir(join(fullPath, '..'), { recursive: true })
        await fs.writeFile(
          fullPath,
          `// Valid TypeScript file\nexport const value = 1\n`,
        )
      }

      const agent = new ArchitectureGuardianAgent('architecture-review')

      const archContext: ArchitectureContext = {
        patterns: [
          {
            name: 'TypeScript',
            description: 'TypeScript pattern',
            applicableFiles: ['*.ts'],
            constraints: ['Strict mode'],
          },
        ],
        moduleBoundaries: [],
        adrs: {},
        adrsFound: 0,
        potentialViolations: [],
      }

      const implementationResult: ImplementationResult = {
        modifiedFiles: filePaths,
        addedTests: [],
        duration: 1000,
        backend: 'test',
        selfCorrectionAttempts: 0,
      }

      const context = createMockContext(
        {
          architecture: archContext,
          phaseOutputs: {
            implementation: implementationResult,
          },
        },
        tempDir,
      )

      const result = await agent.execute(context)

      expect(result.success).toBe(true)
      const review = result.output as ArchitectureReview

      // All modified files should be in the review output
      expect(review.modifiedFiles).toEqual(filePaths)

      // If no violations, all files were reviewed and passed
      // If violations, they should reference files from the modified set
      for (const violation of review.violations) {
        expect(filePaths).toContain(violation.file)
      }
    } finally {
      await cleanupTempDir(tempDir)
    }
  })

  test.prop([
    fc.array(
      fc.record({
        path: fc.string({ minLength: 5, maxLength: 30 }).map((s) => {
          // Generate valid file paths with .ts extension
          const clean = s.replace(/[^a-zA-Z0-9-]/g, '').replace(/^\//, '')
          return clean ? `src/${clean}.ts` : 'src/test.ts'
        }),
        usesAny: fc.boolean(),
        isClassComponent: fc.boolean(),
      }),
      { minLength: 1, maxLength: 10 },
    ),
  ])('should detect violations in any modified file', async (files) => {
    const tempDir = await createTempDir('kaso-violation-test')
    try {
      // Create files with potential violations
      await fs.mkdir(join(tempDir, 'src'), { recursive: true })

      // Filter out files with empty paths
      const validFiles = files.filter((f) => f.path && f.path.length > 0)

      for (const file of validFiles) {
        const fullPath = join(tempDir, file.path)
        await fs.mkdir(join(fullPath, '..'), { recursive: true })

        let content = '// File\n'
        if (file.usesAny) {
          content += 'export const x: any = 1\n'
        } else {
          content += 'export const x: number = 1\n'
        }

        await fs.writeFile(fullPath, content)
      }

      const agent = new ArchitectureGuardianAgent('architecture-review')

      const archContext: ArchitectureContext = {
        patterns: [
          {
            name: 'TypeScript',
            description: 'TypeScript with strict mode',
            applicableFiles: ['*.ts'], // Use proper file extension pattern
            constraints: ['No explicit any'],
          },
        ],
        moduleBoundaries: [],
        adrs: {},
        adrsFound: 0,
        potentialViolations: [],
      }

      const filePaths = validFiles.map((f) => f.path)
      const implementationResult: ImplementationResult = {
        modifiedFiles: filePaths,
        addedTests: [],
        duration: 1000,
        backend: 'test',
        selfCorrectionAttempts: 0,
      }

      const context = createMockContext(
        {
          architecture: archContext,
          phaseOutputs: {
            implementation: implementationResult,
          },
        },
        tempDir,
      )

      const result = await agent.execute(context)

      expect(result.success).toBe(true)
      const review = result.output as ArchitectureReview

      // Files with `any` should have violations (only check valid files)
      const filesWithAny = validFiles
        .filter((f) => f.usesAny)
        .map((f) => f.path)
      const violatedFiles = new Set(review.violations.map((v) => v.file))

      for (const filePath of filesWithAny) {
        expect(violatedFiles.has(filePath)).toBe(true)
      }
    } finally {
      await cleanupTempDir(tempDir)
    }
  })

  test.prop([fc.integer({ min: 1, max: 50 }), fc.boolean()])(
    'should handle large numbers of modified files',
    async (fileCount, hasViolation) => {
      const tempDir = await createTempDir('kaso-large-test')
      try {
        // Create many files
        await fs.mkdir(join(tempDir, 'src', 'components'), { recursive: true })
        const filePaths: string[] = []

        for (let i = 0; i < fileCount; i++) {
          const filePath = `src/components/Component${i}.tsx`
          filePaths.push(filePath)

          const content =
            hasViolation && i === 0
              ? 'export const x: any = 1' // First file has violation
              : 'export const Component = () => null'

          await fs.writeFile(join(tempDir, filePath), content)
        }

        const agent = new ArchitectureGuardianAgent('architecture-review')

        const archContext: ArchitectureContext = {
          patterns: [
            {
              name: 'TypeScript',
              description: 'TypeScript',
              applicableFiles: ['*.tsx'],
              constraints: ['No explicit any'],
            },
          ],
          moduleBoundaries: [],
          adrs: {},
          adrsFound: 0,
          potentialViolations: [],
        }

        const implementationResult: ImplementationResult = {
          modifiedFiles: filePaths,
          addedTests: [],
          duration: 1000,
          backend: 'test',
          selfCorrectionAttempts: 0,
        }

        const context = createMockContext(
          {
            architecture: archContext,
            phaseOutputs: {
              implementation: implementationResult,
            },
          },
          tempDir,
        )

        const result = await agent.execute(context)

        expect(result.success).toBe(true)
        const review = result.output as ArchitectureReview

        // All files should be in modifiedFiles
        expect(review.modifiedFiles.length).toBe(fileCount)

        // Approval status should reflect violations
        if (hasViolation) {
          expect(review.approved).toBe(false)
          expect(review.violations.length).toBeGreaterThan(0)
        } else {
          expect(review.approved).toBe(true)
        }
      } finally {
        await cleanupTempDir(tempDir)
      }
    },
  )
})

describe('Additional architecture properties', () => {
  /**
   * Property: Pattern detection is consistent
   * For any codebase with consistent tech stack indicators,
   * the agent SHALL detect the same patterns consistently.
   */
  test.prop([
    fc.constantFrom('react', 'vue'), // Only test frameworks we explicitly detect
    fc.boolean(), // Include TypeScript
  ])(
    'should consistently detect tech stack patterns',
    async (framework, hasTypeScript) => {
      const tempDir = await createTempDir('kaso-tech-stack-test')
      try {
        const deps: Record<string, string> = {}
        deps[framework] = '^1.0.0'
        if (hasTypeScript) {
          deps['typescript'] = '^5.0.0'
        }

        await fs.writeFile(
          join(tempDir, 'package.json'),
          JSON.stringify({ dependencies: deps }),
        )

        const agent = new ArchitectureGuardianAgent('architecture-analysis')
        const assembledContext = createMockAssembledContext()
        const context = createMockContext(
          {
            phaseOutputs: {
              intake: assembledContext,
            },
          },
          tempDir,
        )

        const result = await agent.execute(context)

        expect(result.success).toBe(true)
        const archContext = result.output as ArchitectureContext

        // Map framework names to expected pattern names
        const expectedPatternName = framework === 'vue' ? 'Vue.js' : 'React'
        const frameworkPattern = archContext.patterns.find(
          (p) => p.name.toLowerCase() === expectedPatternName.toLowerCase(),
        )
        expect(frameworkPattern).toBeDefined()

        const tsPattern = archContext.patterns.find(
          (p) => p.name === 'TypeScript',
        )
        if (hasTypeScript) {
          expect(tsPattern).toBeDefined()
        }
      } finally {
        await cleanupTempDir(tempDir)
      }
    },
  )

  /**
   * Property: Review decision is deterministic
   * For the same input, the review SHALL produce the same output.
   */
  test.prop([fc.string({ minLength: 0, maxLength: 200 })])(
    'should produce deterministic review results',
    async (fileContent) => {
      const tempDir = await createTempDir('kaso-deterministic-test')
      try {
        await fs.mkdir(join(tempDir, 'src'), { recursive: true })
        await fs.writeFile(join(tempDir, 'src', 'test.ts'), fileContent)

        const agent = new ArchitectureGuardianAgent('architecture-review')

        const archContext: ArchitectureContext = {
          patterns: [
            {
              name: 'TypeScript',
              description: 'TypeScript',
              applicableFiles: ['*.ts'],
              constraints: ['No explicit any'],
            },
          ],
          moduleBoundaries: [],
          adrs: {},
          adrsFound: 0,
          potentialViolations: [],
        }

        const implementationResult: ImplementationResult = {
          modifiedFiles: ['src/test.ts'],
          addedTests: [],
          duration: 1000,
          backend: 'test',
          selfCorrectionAttempts: 0,
        }

        const context = createMockContext(
          {
            architecture: archContext,
            phaseOutputs: {
              implementation: implementationResult,
            },
          },
          tempDir,
        )

        const result1 = await agent.execute(context)
        const result2 = await agent.execute(context)

        expect(result1.success).toBe(result2.success)
        if (result1.success && result2.success) {
          const review1 = result1.output as ArchitectureReview
          const review2 = result2.output as ArchitectureReview
          expect(review1.approved).toBe(review2.approved)
          expect(review1.violations.length).toBe(review2.violations.length)
        }
      } finally {
        await cleanupTempDir(tempDir)
      }
    },
  )
})
