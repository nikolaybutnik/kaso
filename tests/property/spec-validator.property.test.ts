/**
 * Property tests for SpecValidatorAgent
 */

import { test, fc } from '@fast-check/vitest'
import { expect } from 'vitest'
import { SpecValidatorAgent } from '../../src/agents/spec-validator'
import type {
  AgentContext,
  AssembledContext,
  ValidationReport,
} from '../../src/core/types'
import { getDefaultConfig } from '../../src/config/schema'

/**
 * Arbitrary for generating markdown content with potential validation issues
 */
const markdownWithIssuesArbitrary = fc.oneof(
  // Valid content
  fc.constant(
    '# Design\n\nComplete API specification.\n\n## Error Handling\n\nTry-catch blocks implemented.',
  ),
  // Content with API issues
  fc.constant(
    '# Design\n\nThe API endpoints are not defined yet.\n\nTODO: Define API contracts.',
  ),
  // Content with DB issues
  fc.constant(
    '# Design\n\nDatabase schema is missing.\n\nTable structures not specified.',
  ),
  // Content with error handling issues
  fc.constant(
    '# Design\n\nFunctions implemented without try-catch.\n\nError handling not defined.',
  ),
  // Content with contradictions
  fc.constant('# Design\n\nUsing Vue.js for frontend.\n\nMySQL for database.'),
)

/**
 * Arbitrary for generating agent context
 */
const agentContextArbitrary = fc
  .record({
    designContent: markdownWithIssuesArbitrary,
    techSpecContent: markdownWithIssuesArbitrary,
    hasArchitecture: fc.boolean(),
    archPatterns: fc.integer({ min: 0, max: 3 }),
  })
  .map(({ designContent, techSpecContent, hasArchitecture, archPatterns }) => {
    const assembled: AssembledContext = {
      featureName: 'test-feature',
      designDoc: {
        rawContent: designContent,
        sections: [],
        codeBlocks: [],
        metadata: {},
      },
      techSpec: {
        rawContent: techSpecContent,
        sections: [],
        codeBlocks: [],
        metadata: {},
      },
      taskList: [],
      architectureDocs: {},
      dependencies: {},
      removedFiles: [],
    }

    const context: AgentContext = {
      runId: 'test-run',
      spec: {
        featureName: 'test-feature',
        specPath: '/test/specs/test-feature',
        missingFiles: [],
      },
      steering: { hooks: {} },
      phaseOutputs: {
        intake: assembled,
      },
      config: getDefaultConfig(),
      backends: {},
      architecture: hasArchitecture
        ? {
            patterns: Array.from({ length: archPatterns }, (_, i) => ({
              name: `Pattern ${i}`,
              description: `Description ${i}`,
              applicableFiles: [],
              constraints: ['Constraint 1'],
            })),
            moduleBoundaries: [],
            adrs: {},
            adrsFound: archPatterns,
          }
        : undefined,
    }

    return context
  })

/**
 * Property 17: Validation output conforms to ValidationReport schema
 * The output of spec validation should always be a valid ValidationReport structure
 */
test.prop([agentContextArbitrary])(
  'Property 17: Validation output conforms to ValidationReport schema',
  async (context) => {
    const agent = new SpecValidatorAgent()

    const result = await agent.execute(context)

    // Verify result structure
    expect(result.success).toBeDefined()
    expect(result.duration).toBeDefined()
    expect(typeof result.duration).toBe('number')
    expect(result.duration).toBeGreaterThanOrEqual(0)

    if (result.success) {
      // Verify ValidationReport schema
      expect(result.output).toBeDefined()

      const report = result.output as ValidationReport
      expect(report.approved).toBeDefined()
      expect(typeof report.approved).toBe('boolean')

      expect(report.issues).toBeDefined()
      expect(Array.isArray(report.issues)).toBe(true)

      // Verify each issue conforms to schema
      for (const issue of report.issues) {
        expect(issue.type).toBeDefined()
        expect([
          'api-contract',
          'db-schema',
          'error-handling',
          'contradiction',
        ]).toContain(issue.type)

        expect(issue.severity).toBeDefined()
        expect(['error', 'warning']).toContain(issue.severity)

        expect(issue.description).toBeDefined()
        expect(typeof issue.description).toBe('string')
        expect(issue.description.length).toBeGreaterThan(0)

        expect(issue.suggestion).toBeDefined()
        expect(typeof issue.suggestion).toBe('string')
        expect(issue.suggestion?.length).toBeGreaterThan(0)

        expect(issue.location).toBeDefined()
        expect(typeof issue.location).toBe('string')
      }

      expect(report.suggestedFixes).toBeDefined()
      expect(Array.isArray(report.suggestedFixes)).toBe(true)

      // Verify each suggested fix is a non-empty string
      for (const fix of report.suggestedFixes) {
        expect(typeof fix).toBe('string')
        expect(fix.length).toBeGreaterThan(0)
      }

      // Verify approved flag matches issues
      if (report.issues.length === 0) {
        expect(report.approved).toBe(true)
        expect(
          report.suggestedFixes.some(
            (f: string) => f.includes('complete') || f.includes('well-defined'),
          ),
        ).toBe(true)
      } else {
        expect(report.approved).toBe(false)
      }
    } else {
      // Error case
      expect(result.error).toBeDefined()
      expect(result.error?.message).toBeDefined()
      expect(result.error?.retryable).toBe(false)
    }
  },
)

/**
 * Additional property: Validation detects missing required context
 * The validator should fail gracefully when required context is missing
 */
test.prop([fc.boolean()])(
  'Validation detects missing required context',
  async (hasIntakeOutput) => {
    const agent = new SpecValidatorAgent()

    const context: AgentContext = {
      runId: 'test-run',
      spec: {
        featureName: 'test-feature',
        specPath: '/test/specs/test-feature',
        missingFiles: [],
      },
      steering: { hooks: {} },
      phaseOutputs: hasIntakeOutput
        ? {
            intake: {
              featureName: 'test-feature',
              designDoc: {
                rawContent: '# Design',
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
            },
          }
        : {},
      config: getDefaultConfig(),
      backends: {},
    }

    const result = await agent.execute(context)

    if (hasIntakeOutput) {
      // Should succeed with intake output
      expect(result.success).toBe(true)
      expect(result.output).toBeDefined()
    } else {
      // Should fail without intake output
      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error?.message).toContain('Missing intake phase output')
    }
  },
)

/**
 * Additional property: Severity levels are consistent
 * All issues should have valid severity levels
 */
test.prop([agentContextArbitrary])(
  'Severity levels are consistent',
  async (context) => {
    const agent = new SpecValidatorAgent()

    const result = await agent.execute(context)

    if (result.success && result.output) {
      const report = result.output as ValidationReport

      for (const issue of report.issues) {
        // Severity must be either 'error' or 'warning'
        expect(issue.severity).toMatch(/^(error|warning)$/)

        // Critical issues (undefined APIs, missing DB schemas, missing error handling phrases) should be errors
        const hasCriticalKeywords =
          /not defined|undefined|missing|TODO|FIXME/i.test(issue.description)
        if (hasCriticalKeywords) {
          expect(issue.severity).toBe('error')
        }
      }
    }
  },
)

/**
 * Additional property: Issue types are valid
 * All issues should have one of the valid types
 */
test.prop([agentContextArbitrary])('Issue types are valid', async (context) => {
  const agent = new SpecValidatorAgent()

  const result = await agent.execute(context)

  if (result.success && result.output) {
    const report = result.output as ValidationReport
    const validTypes = [
      'api-contract',
      'db-schema',
      'error-handling',
      'contradiction',
    ]

    for (const issue of report.issues) {
      expect(validTypes).toContain(issue.type)
    }
  }
})
