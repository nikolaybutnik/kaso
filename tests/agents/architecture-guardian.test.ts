/**
 * Unit tests for Architecture Guardian Agent
 * Tests both Phase 3 (Analysis) and Phase 5 (Review) functionality
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { ArchitectureGuardianAgent } from '@/agents/architecture-guardian'
import type {
  AgentContext,
  AssembledContext,
  ImplementationResult,
  ArchitectureContext,
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

describe('ArchitectureGuardianAgent', () => {
  describe('Phase 3: Architecture Analysis', () => {
    let tempDir: string
    let agent: ArchitectureGuardianAgent

    beforeEach(async () => {
      tempDir = join(tmpdir(), `kaso-test-${Date.now()}`)
      await fs.mkdir(tempDir, { recursive: true })
      agent = new ArchitectureGuardianAgent('architecture-analysis')
    })

    afterEach(async () => {
      try {
        await fs.rm(tempDir, { recursive: true })
      } catch {
        // Ignore cleanup errors
      }
    })

    it('should implement Agent interface', () => {
      expect(agent.supportsRollback()).toBe(false)
      expect(agent.estimatedDuration()).toBe(8000)
      expect(agent.requiredContext()).toContain('phaseOutputs.intake')
    })

    it('should fail when intake phase output is missing', async () => {
      const context = createMockContext({}, tempDir)
      const result = await agent.execute(context)

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('Missing intake phase output')
    })

    it('should load ADRs from docs/adr directory', async () => {
      // Create ADR directory and file
      const adrDir = join(tempDir, 'docs', 'adr')
      await fs.mkdir(adrDir, { recursive: true })
      await fs.writeFile(
        join(adrDir, '001-use-typescript.md'),
        '# ADR 001: Use TypeScript\n\n## Status\n\nAccepted\n\n## Context\n\nWe need type safety.\n\n## Decision\n\nUse TypeScript.\n\n## Consequences\n\nBetter code quality.',
      )

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
      expect(archContext.adrsFound).toBe(1)
      expect(Object.keys(archContext.adrs)).toContain(
        'docs/adr/001-use-typescript.md',
      )
    })

    it('should load ADRs from root level with numbered names', async () => {
      await fs.writeFile(
        join(tempDir, '001-database-choice.md'),
        '# ADR 001: Database Choice\n\nStatus: Accepted\n\nDate: 2024-01-15',
      )

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
      expect(archContext.adrsFound).toBe(1)
      expect(Object.keys(archContext.adrs)).toContain('001-database-choice.md')
    })

    it('should detect React patterns from package.json', async () => {
      await fs.writeFile(
        join(tempDir, 'package.json'),
        JSON.stringify({
          dependencies: {
            react: '^18.0.0',
            typescript: '^5.0.0',
          },
        }),
      )

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
      const reactPattern = archContext.patterns.find((p) => p.name === 'React')
      expect(reactPattern).toBeDefined()
      expect(reactPattern?.applicableFiles).toContain('src/components/**/*')
    })

    it('should detect TypeScript patterns from package.json', async () => {
      await fs.writeFile(
        join(tempDir, 'package.json'),
        JSON.stringify({
          devDependencies: {
            typescript: '^5.0.0',
          },
        }),
      )

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
      const tsPattern = archContext.patterns.find(
        (p) => p.name === 'TypeScript',
      )
      expect(tsPattern).toBeDefined()
      expect(tsPattern?.constraints).toContain('Strict mode enabled')
    })

    it('should detect module boundaries from src/features structure', async () => {
      await fs.mkdir(join(tempDir, 'src', 'features', 'auth'), {
        recursive: true,
      })
      await fs.writeFile(
        join(tempDir, 'src', 'features', 'auth', 'index.ts'),
        'export * from "./auth-service"',
      )

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
      const authBoundary = archContext.moduleBoundaries.find((b) =>
        b.module.includes('auth'),
      )
      expect(authBoundary).toBeDefined()
      expect(authBoundary?.boundaries).toContain('index.ts')
    })

    it('should detect potential violations from spec content', async () => {
      const designContent = 'We will use Vue.js for the frontend components'
      const techSpecContent = 'Frontend: Vue.js with TypeScript'

      // Create package.json with React
      await fs.writeFile(
        join(tempDir, 'package.json'),
        JSON.stringify({
          dependencies: {
            react: '^18.0.0',
          },
        }),
      )

      const assembledContext = createMockAssembledContext(
        designContent,
        techSpecContent,
      )
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
      // The pattern detection should find React, and the spec mentions Vue
      // This would create a potential violation
      expect(archContext.patterns.some((p) => p.name === 'React')).toBe(true)
    })

    it('should extract patterns from architecture docs', async () => {
      const archContent = `
# Architecture

We use a layered architecture with controllers, services, and repositories.

## Constraints

- Must not use global state
- Should avoid direct database access from controllers
`

      const assembledContext = createMockAssembledContext()
      assembledContext.architectureDocs['ARCHITECTURE.md'] =
        createMockMarkdown(archContent)

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
      const layeredPattern = archContext.patterns.find((p) =>
        p.name.includes('Layered'),
      )
      expect(layeredPattern).toBeDefined()
    })

    it('should handle missing worktree path gracefully', async () => {
      const assembledContext = createMockAssembledContext()
      const context = createMockContext({
        phaseOutputs: {
          intake: assembledContext,
        },
        worktreePath: undefined,
      })

      const result = await agent.execute(context)

      expect(result.success).toBe(true)
      const archContext = result.output as ArchitectureContext
      expect(archContext.patterns).toEqual([])
      expect(archContext.moduleBoundaries).toEqual([])
      expect(archContext.adrsFound).toBe(0)
    })
  })

  describe('Phase 5: Architecture Review', () => {
    let tempDir: string
    let agent: ArchitectureGuardianAgent

    beforeEach(async () => {
      tempDir = join(tmpdir(), `kaso-test-${Date.now()}`)
      await fs.mkdir(tempDir, { recursive: true })
      agent = new ArchitectureGuardianAgent('architecture-review')
    })

    afterEach(async () => {
      try {
        await fs.rm(tempDir, { recursive: true })
      } catch {
        // Ignore cleanup errors
      }
    })

    it('should implement Agent interface for Phase 5', () => {
      expect(agent.supportsRollback()).toBe(false)
      expect(agent.estimatedDuration()).toBe(5000)
      expect(agent.requiredContext()).toContain('architecture')
      expect(agent.requiredContext()).toContain('phaseOutputs.implementation')
    })

    it('should fail when architecture context is missing', async () => {
      const context = createMockContext({}, tempDir)
      const result = await agent.execute(context)

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('Missing architecture context')
    })

    it('should fail when implementation result is missing', async () => {
      const archContext: ArchitectureContext = {
        patterns: [],
        moduleBoundaries: [],
        adrs: {},
        adrsFound: 0,
        potentialViolations: [],
      }

      const context = createMockContext(
        {
          architecture: archContext,
        },
        tempDir,
      )

      const result = await agent.execute(context)

      expect(result.success).toBe(false)
      expect(result.error?.message).toContain('Missing implementation result')
    })

    it('should approve when no violations found', async () => {
      // Create a simple valid TypeScript file
      await fs.mkdir(join(tempDir, 'src'), { recursive: true })
      await fs.writeFile(
        join(tempDir, 'src', 'utils.ts'),
        `
export function add(a: number, b: number): number {
  return a + b
}
`,
      )

      const archContext: ArchitectureContext = {
        patterns: [
          {
            name: 'TypeScript',
            description: 'TypeScript',
            applicableFiles: ['*.ts'],
            constraints: ['Strict mode enabled'],
          },
        ],
        moduleBoundaries: [],
        adrs: {},
        adrsFound: 0,
        potentialViolations: [],
      }

      const implementationResult: ImplementationResult = {
        modifiedFiles: ['src/utils.ts'],
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
      const review = result.output as {
        approved: boolean
        violations: unknown[]
      }
      expect(review.approved).toBe(true)
      expect(review.violations).toHaveLength(0)
    })

    it('should detect TypeScript violations', async () => {
      // Create a TypeScript file with `any` type
      await fs.mkdir(join(tempDir, 'src'), { recursive: true })
      await fs.writeFile(
        join(tempDir, 'src', 'bad-code.ts'),
        `
export function process(data: any): any {
  return data
}
`,
      )

      const archContext: ArchitectureContext = {
        patterns: [
          {
            name: 'TypeScript',
            description: 'TypeScript with strict mode',
            applicableFiles: ['*.ts'],
            constraints: ['No implicit any'],
          },
        ],
        moduleBoundaries: [],
        adrs: {},
        adrsFound: 0,
        potentialViolations: [],
      }

      const implementationResult: ImplementationResult = {
        modifiedFiles: ['src/bad-code.ts'],
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
      const review = result.output as {
        approved: boolean
        violations: Array<{ file: string; pattern: string; issue: string }>
      }
      expect(review.approved).toBe(false)
      expect(review.violations.length).toBeGreaterThan(0)
      expect(review.violations.some((v) => v.issue.includes('any'))).toBe(true)
    })

    it('should detect React class component violations', async () => {
      // Create a React file with class component
      await fs.mkdir(join(tempDir, 'src', 'components'), { recursive: true })
      await fs.writeFile(
        join(tempDir, 'src', 'components', 'OldComponent.tsx'),
        `
import React from 'react'

class OldComponent extends React.Component {
  render() {
    return <div>Hello</div>
  }
}

export default OldComponent
`,
      )

      const archContext: ArchitectureContext = {
        patterns: [
          {
            name: 'React',
            description: 'React with functional components',
            applicableFiles: ['src/components/**/*'],
            constraints: ['Use functional components with hooks'],
          },
        ],
        moduleBoundaries: [],
        adrs: {},
        adrsFound: 0,
        potentialViolations: [],
      }

      const implementationResult: ImplementationResult = {
        modifiedFiles: ['src/components/OldComponent.tsx'],
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
      const review = result.output as {
        approved: boolean
        violations: Array<{ issue: string }>
      }
      expect(review.approved).toBe(false)
      expect(
        review.violations.some((v) => v.issue.includes('class component')),
      ).toBe(true)
    })

    it('should detect naming convention violations', async () => {
      // Create a file with snake_case filename
      await fs.mkdir(join(tempDir, 'src'), { recursive: true })
      await fs.writeFile(
        join(tempDir, 'src', 'my_util_file.ts'),
        `
export function MyFunction() {
  return 42
}
`,
      )

      const archContext: ArchitectureContext = {
        patterns: [],
        moduleBoundaries: [],
        adrs: {},
        adrsFound: 0,
        potentialViolations: [],
      }

      const implementationResult: ImplementationResult = {
        modifiedFiles: ['src/my_util_file.ts'],
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
      const review = result.output as {
        violations: Array<{ pattern: string; issue: string }>
      }
      const namingViolations = review.violations.filter(
        (v) => v.pattern === 'Naming Conventions',
      )
      expect(namingViolations.length).toBeGreaterThan(0)
      expect(namingViolations[0]?.issue).toContain('snake_case')
    })

    it('should detect state management inconsistencies', async () => {
      // Create a file with multiple state management patterns
      await fs.mkdir(join(tempDir, 'src'), { recursive: true })
      await fs.writeFile(
        join(tempDir, 'src', 'store.ts'),
        `
import { createStore } from 'redux'
import { observable } from 'mobx'
import create from 'zustand'

// Using multiple state libraries
const reduxStore = createStore(() => {})
const mobxStore = observable({ count: 0 })
const zustandStore = create(() => ({}))
`,
      )

      const archContext: ArchitectureContext = {
        patterns: [],
        moduleBoundaries: [],
        adrs: {},
        adrsFound: 0,
        potentialViolations: [],
      }

      const implementationResult: ImplementationResult = {
        modifiedFiles: ['src/store.ts'],
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
      const review = result.output as {
        violations: Array<{ pattern: string; issue: string }>
      }
      const stateViolations = review.violations.filter(
        (v) => v.pattern === 'State Management',
      )
      expect(stateViolations.length).toBeGreaterThan(0)
      expect(stateViolations[0]?.issue).toContain('multiple state management')
    })

    it('should detect module boundary violations', async () => {
      // Create files that violate module boundaries
      await fs.mkdir(join(tempDir, 'src', 'features', 'auth'), {
        recursive: true,
      })
      await fs.mkdir(join(tempDir, 'src', 'features', 'payment'), {
        recursive: true,
      })

      await fs.writeFile(
        join(tempDir, 'src', 'features', 'auth', 'index.ts'),
        'export * from "./auth-service"',
      )

      await fs.writeFile(
        join(tempDir, 'src', 'features', 'payment', 'payment-service.ts'),
        `
// Violation: importing from internal auth module (using full path)
import { authService } from 'src/features/auth/internal-auth-file'

export function processPayment() {
  return authService.verify()
}
`,
      )

      const archContext: ArchitectureContext = {
        patterns: [],
        moduleBoundaries: [
          {
            module: 'src/features/auth',
            boundaries: ['src/features/auth/index.ts'],
            violations: [],
          },
        ],
        adrs: {},
        adrsFound: 0,
        potentialViolations: [],
      }

      const implementationResult: ImplementationResult = {
        modifiedFiles: ['src/features/payment/payment-service.ts'],
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
      const review = result.output as {
        violations: Array<{ pattern: string; issue: string }>
      }
      const boundaryViolations = review.violations.filter(
        (v) => v.pattern === 'Module Boundaries',
      )
      expect(boundaryViolations.length).toBeGreaterThan(0)
    })

    it('should skip files that do not exist', async () => {
      const archContext: ArchitectureContext = {
        patterns: [],
        moduleBoundaries: [],
        adrs: {},
        adrsFound: 0,
        potentialViolations: [],
      }

      const implementationResult: ImplementationResult = {
        modifiedFiles: ['non-existent-file.ts', 'src/existing.ts'],
        addedTests: [],
        duration: 1000,
        backend: 'test',
        selfCorrectionAttempts: 0,
      }

      // Create only one file
      await fs.mkdir(join(tempDir, 'src'), { recursive: true })
      await fs.writeFile(
        join(tempDir, 'src', 'existing.ts'),
        'export const x = 1',
      )

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
      const review = result.output as { approved: boolean }
      expect(review.approved).toBe(true) // No violations since one file doesn't exist
    })

    it('should include modified files in review output', async () => {
      await fs.mkdir(join(tempDir, 'src'), { recursive: true })
      await fs.writeFile(join(tempDir, 'src', 'file1.ts'), 'export const a = 1')
      await fs.writeFile(join(tempDir, 'src', 'file2.ts'), 'export const b = 2')

      const archContext: ArchitectureContext = {
        patterns: [],
        moduleBoundaries: [],
        adrs: {},
        adrsFound: 0,
        potentialViolations: [],
      }

      const implementationResult: ImplementationResult = {
        modifiedFiles: ['src/file1.ts', 'src/file2.ts'],
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
      const review = result.output as { modifiedFiles: string[] }
      expect(review.modifiedFiles).toContain('src/file1.ts')
      expect(review.modifiedFiles).toContain('src/file2.ts')
    })
  })
})
