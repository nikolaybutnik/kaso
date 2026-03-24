/**
 * Unit tests for SpecValidatorAgent
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { SpecValidatorAgent } from '../../src/agents/spec-validator'
import type {
  AgentContext,
  AssembledContext,
  ArchitectureContext,
  ValidationReport,
} from '../../src/core/types'
import { getDefaultConfig } from '../../src/config/schema'

describe('SpecValidatorAgent', () => {
  let agent: SpecValidatorAgent
  let mockContext: AgentContext

  beforeEach(() => {
    agent = new SpecValidatorAgent()
    mockContext = {
      runId: 'test-run',
      spec: {
        featureName: 'test-feature',
        specPath: '/test/specs/test-feature',
        missingFiles: [],
      },
      steering: { hooks: {} },
      phaseOutputs: {},
      config: getDefaultConfig(),
      backends: {},
    }
  })

  describe('execute', () => {
    it('should validate a complete spec successfully', async () => {
      const assembledContext: AssembledContext = {
        featureName: 'test-feature',
        designDoc: {
          rawContent:
            '# Design\n\nAPI endpoints with proper schemas.\n\n## Error Handling\n\nTry-catch blocks with custom error types.',
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
        techSpec: {
          rawContent:
            '# Tech Spec\n\nDatabase schema with CREATE TABLE statements.\n\n```sql\nCREATE TABLE users (id INT, name VARCHAR(255));\n```',
          sections: [],
          codeBlocks: [
            {
              language: 'sql',
              content: 'CREATE TABLE users (id INT, name VARCHAR(255));',
              lineStart: 5,
            },
          ],
          metadata: {},
        },
        taskList: [],
        architectureDocs: {},
        dependencies: {},
        removedFiles: [],
      }

      mockContext.phaseOutputs['intake'] = assembledContext

      const result = await agent.execute(mockContext)

      expect(result.success).toBe(true)
      expect(result.output).toBeDefined()

      const report = result.output as ValidationReport
      expect(report.approved).toBe(true)
      expect(report.issues).toHaveLength(0)
      expect(report.suggestedFixes).toContain(
        'Spec is complete and well-defined',
      )
    })

    it('should detect undefined API contracts', async () => {
      const assembledContext: AssembledContext = {
        featureName: 'test-feature',
        designDoc: {
          rawContent:
            '# Design\n\nThe API endpoints are not defined yet.\n\nTODO: Define API contracts',
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
        techSpec: {
          rawContent: '# Tech Spec\n\nAPI specification is undefined.',
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
        taskList: [],
        architectureDocs: {},
        dependencies: {},
        removedFiles: [],
      }

      mockContext.phaseOutputs['intake'] = assembledContext

      const result = await agent.execute(mockContext)

      expect(result.success).toBe(true)
      const report = result.output as ValidationReport
      expect(report.approved).toBe(false)
      expect(report.issues.length).toBeGreaterThan(0)
      expect(report.issues.some((i) => i.type === 'api-contract')).toBe(true)
      expect(
        report.suggestedFixes.some((f: string) => f.includes('API contract')),
      ).toBe(true)
    })

    it('should detect missing database schemas', async () => {
      const assembledContext: AssembledContext = {
        featureName: 'test-feature',
        designDoc: {
          rawContent:
            '# Design\n\nWe need a database table but the schema is missing.\n\nThe database schema is not defined.',
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
        techSpec: {
          rawContent:
            '# Tech Spec\n\nDatabase tables are mentioned but no CREATE TABLE statements.',
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
        taskList: [],
        architectureDocs: {},
        dependencies: {},
        removedFiles: [],
      }

      mockContext.phaseOutputs['intake'] = assembledContext

      const result = await agent.execute(mockContext)

      expect(result.success).toBe(true)
      const report = result.output as ValidationReport
      expect(report.approved).toBe(false)
      expect(report.issues.length).toBeGreaterThan(0)
      expect(report.issues.some((i) => i.type === 'db-schema')).toBe(true)
      expect(
        report.suggestedFixes.some((f: string) => f.includes('schema')),
      ).toBe(true)
    })

    it('should detect missing error handling', async () => {
      const assembledContext: AssembledContext = {
        featureName: 'test-feature',
        designDoc: {
          rawContent:
            '# Design\n\nFunctions will be implemented but error handling is not defined.\n\nTODO: Add error handling.',
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
        techSpec: {
          rawContent:
            '# Tech Spec\n\nfunction processData() {\n  // No try-catch\n}',
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
        taskList: [],
        architectureDocs: {},
        dependencies: {},
        removedFiles: [],
      }

      mockContext.phaseOutputs['intake'] = assembledContext

      const result = await agent.execute(mockContext)

      expect(result.success).toBe(true)
      const report = result.output as ValidationReport
      expect(report.approved).toBe(false)
      expect(report.issues.length).toBeGreaterThan(0)
      expect(report.issues.some((i) => i.type === 'error-handling')).toBe(true)
      expect(
        report.suggestedFixes.some((f: string) => f.includes('error handling')),
      ).toBe(true)
    })

    it('should detect architectural contradictions', async () => {
      const assembledContext: AssembledContext = {
        featureName: 'test-feature',
        designDoc: {
          rawContent:
            '# Design\n\nWe will use Vue.js for the frontend.\n\nThe database will be MySQL.',
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
        techSpec: {
          rawContent:
            '# Tech Spec\n\nFrontend: Vue.js components\nDatabase: MySQL',
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
        taskList: [],
        architectureDocs: {},
        dependencies: {},
        removedFiles: [],
      }

      const architectureContext: ArchitectureContext = {
        patterns: [
          {
            name: 'React Frontend',
            description: 'Use React for frontend components',
            applicableFiles: ['*.tsx', '*.jsx'],
            constraints: [
              'Use functional components',
              'Use hooks for state management',
            ],
          },
          {
            name: 'PostgreSQL Database',
            description: 'PostgreSQL is the standard database',
            applicableFiles: ['migrations/*.sql', 'models/*.ts'],
            constraints: [
              'Use UUID primary keys',
              'Use snake_case for columns',
            ],
          },
        ],
        moduleBoundaries: [
          {
            module: 'frontend',
            boundaries: ['components/**', 'pages/**'],
            violations: [],
          },
        ],
        adrs: {},
        adrsFound: 2,
        potentialViolations: [],
      }

      mockContext.phaseOutputs['intake'] = assembledContext
      mockContext.architecture = architectureContext

      const result = await agent.execute(mockContext)

      expect(result.success).toBe(true)
      const report = result.output as ValidationReport
      expect(report.approved).toBe(false)
      expect(report.issues.some((i) => i.type === 'contradiction')).toBe(true)
      expect(
        report.issues.some(
          (i) =>
            i.description.includes('Vue.js') && i.description.includes('React'),
        ),
      ).toBe(true)
      expect(
        report.issues.some(
          (i) =>
            i.description.includes('MySQL') &&
            i.description.includes('PostgreSQL'),
        ),
      ).toBe(true)
    })

    it('should handle missing intake context', async () => {
      // No intake phase output
      const result = await agent.execute(mockContext)

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('Missing intake phase output')
    })

    it('should detect API routes without schemas', async () => {
      const assembledContext: AssembledContext = {
        featureName: 'test-feature',
        designDoc: {
          rawContent:
            '# Design\n\nAPI endpoint: POST /api/users\n\nThis endpoint creates a user.',
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
        techSpec: {
          rawContent: '# Tech Spec',
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
        taskList: [],
        architectureDocs: {},
        dependencies: {},
        removedFiles: [],
      }

      mockContext.phaseOutputs['intake'] = assembledContext

      const result = await agent.execute(mockContext)

      expect(result.success).toBe(true)
      const report = result.output as ValidationReport
      expect(
        report.issues.some(
          (i) => i.type === 'api-contract' && i.severity === 'warning',
        ),
      ).toBe(true)
    })

    it('should detect code without error handling', async () => {
      const assembledContext: AssembledContext = {
        featureName: 'test-feature',
        designDoc: {
          rawContent:
            '# Design\n\nfunction processData() {\n  return data.map(x => x * 2);\n}',
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
        techSpec: {
          rawContent: '# Tech Spec',
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
        taskList: [],
        architectureDocs: {},
        dependencies: {},
        removedFiles: [],
      }

      mockContext.phaseOutputs['intake'] = assembledContext

      const result = await agent.execute(mockContext)

      expect(result.success).toBe(true)
      const report = result.output as ValidationReport
      expect(
        report.issues.some(
          (i) => i.type === 'error-handling' && i.severity === 'warning',
        ),
      ).toBe(true)
    })

    it('should approve valid spec with minor warnings', async () => {
      const assembledContext: AssembledContext = {
        featureName: 'test-feature',
        designDoc: {
          rawContent:
            '# Design\n\nPOST /api/users with full schema.\n\nDatabase schema defined.\n\nError handling with try-catch.',
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
        techSpec: {
          rawContent:
            '# Tech Spec\n\n```typescript\nfunction processData() {\n  try {\n    // logic\n  } catch (error) {\n    // handle\n  }\n}\n```',
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
        taskList: [],
        architectureDocs: {},
        dependencies: {},
        removedFiles: [],
      }

      mockContext.phaseOutputs['intake'] = assembledContext

      const result = await agent.execute(mockContext)

      expect(result.success).toBe(true)
      const report = result.output as ValidationReport
      // Should either be approved (no issues) or have only minor warnings
      if (!report.approved) {
        expect(report.issues.every((i) => i.severity === 'warning')).toBe(true)
      }
    })
  })

  describe('agent interface', () => {
    it('should implement required interface methods', () => {
      expect(agent.supportsRollback()).toBe(false)
      expect(agent.estimatedDuration()).toBeGreaterThan(0)
      expect(agent.requiredContext()).toContain('phaseOutputs.intake')
    })
  })

  describe('error handling', () => {
    it('should format errors correctly', async () => {
      const assembledContext: AssembledContext = {
        featureName: 'test-feature',
        designDoc: undefined,
        techSpec: undefined,
        taskList: [],
        architectureDocs: {},
        dependencies: {},
        removedFiles: [],
      }

      mockContext.phaseOutputs['intake'] = assembledContext

      const result = await agent.execute(mockContext)

      // Should handle undefined docs gracefully
      expect(result.success).toBe(true)
    })

    it('should not retry on validation errors', async () => {
      const result = await agent.execute(mockContext)

      if (result.error) {
        expect(result.error.retryable).toBe(false)
      }
    })
  })

  describe('severity levels', () => {
    it('should use correct severity levels for different issue types', async () => {
      const assembledContext: AssembledContext = {
        featureName: 'test-feature',
        designDoc: {
          rawContent:
            '# Design\n\nAPI not defined.\n\nDatabase schema missing.\n\nError handling not specified.',
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
        techSpec: {
          rawContent: '# Tech Spec',
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
        taskList: [],
        architectureDocs: {},
        dependencies: {},
        removedFiles: [],
      }

      mockContext.phaseOutputs['intake'] = assembledContext

      const result = await agent.execute(mockContext)

      expect(result.success).toBe(true)
      const report = result.output as ValidationReport

      // All critical issues should be marked as errors
      const hasErrors = report.issues.some((i) => i.severity === 'error')
      expect(hasErrors).toBe(true)
    })
  })

  describe('location tracking', () => {
    it('should include location information for issues', async () => {
      const assembledContext: AssembledContext = {
        featureName: 'test-feature',
        designDoc: {
          rawContent:
            '# Design\n\nLine 3: API not defined here.\n\nLine 5: Database missing.',
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
        techSpec: {
          rawContent: '# Tech Spec',
          sections: [],
          codeBlocks: [],
          metadata: {},
        },
        taskList: [],
        architectureDocs: {},
        dependencies: {},
        removedFiles: [],
      }

      mockContext.phaseOutputs['intake'] = assembledContext

      const result = await agent.execute(mockContext)

      expect(result.success).toBe(true)
      const report = result.output as ValidationReport
      expect(report.issues.length).toBeGreaterThan(0)
      expect(report.issues.every((i) => i.location)).toBe(true)
    })
  })
})
