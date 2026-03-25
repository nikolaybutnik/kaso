/**
 * Phase Output Fixture Factories for E2E Testing
 *
 * Provides factory functions for creating valid phase output objects
 * matching the expected interfaces for all 8 pipeline phases.
 *
 * Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8
 */

import type {
  AssembledContext,
  ValidationReport,
  ArchitectureContext,
  ImplementationResult,
  ArchitectureReview,
  TestReport,
  UIReview,
  ReviewCouncilResult,
  PhaseName,
  ParsedMarkdown,
  TaskItem,
} from '@/core/types'
import type { MockPhaseResponse } from './mock-backend'

/**
 * Create a mock ParsedMarkdown object
 * @param title - Document title
 * @returns ParsedMarkdown fixture
 */
export function createMockParsedMarkdown(title: string): ParsedMarkdown {
  return {
    rawContent: `# ${title}\n\nMock content for testing.`,
    sections: [
      {
        level: 1,
        title,
        content: 'Mock content for testing.',
        codeBlocks: [],
        children: [],
      },
    ],
    codeBlocks: [],
    metadata: {},
  }
}

/**
 * Create mock TaskItems
 * @returns Array of TaskItem fixtures
 */
export function createMockTaskItems(): TaskItem[] {
  return [
    {
      id: '1.0',
      title: 'Setup project structure',
      status: 'complete',
      children: [],
      line: 1,
    },
    {
      id: '2.0',
      title: 'Implement core feature',
      status: 'incomplete',
      children: [
        {
          id: '2.1',
          title: 'Add models',
          status: 'incomplete',
          children: [],
          line: 2,
        },
      ],
      line: 2,
    },
  ]
}

/**
 * Create intake phase output (AssembledContext)
 * @param overrides - Fields to override
 * @returns AssembledContext fixture
 */
export function createIntakeOutput(
  overrides?: Partial<AssembledContext>,
): AssembledContext {
  return {
    featureName: 'mock-feature',
    designDoc: createMockParsedMarkdown('Mock Feature Design'),
    techSpec: createMockParsedMarkdown('Mock Feature Tech Spec'),
    taskList: createMockTaskItems(),
    architectureDocs: {},
    dependencies: {},
    removedFiles: [],
    ...overrides,
  }
}

/**
 * Create validation phase output (ValidationReport)
 * @param overrides - Fields to override
 * @returns ValidationReport fixture
 */
export function createValidationOutput(
  overrides?: Partial<ValidationReport>,
): ValidationReport {
  return {
    approved: true,
    issues: [],
    suggestedFixes: [],
    ...overrides,
  }
}

/**
 * Create architecture analysis phase output (ArchitectureContext)
 * @param overrides - Fields to override
 * @returns ArchitectureContext fixture
 */
export function createArchitectureAnalysisOutput(
  overrides?: Partial<ArchitectureContext>,
): ArchitectureContext {
  return {
    patterns: [
      {
        name: 'Repository Pattern',
        description: 'Data access abstraction',
        applicableFiles: ['src/repositories/*.ts'],
        constraints: ['Must implement BaseRepository'],
      },
    ],
    moduleBoundaries: [
      {
        module: 'core',
        boundaries: ['src/core/**'],
        violations: [],
      },
    ],
    adrs: {},
    adrsFound: 0,
    potentialViolations: [],
    ...overrides,
  }
}

/**
 * Create implementation phase output (ImplementationResult)
 * @param overrides - Fields to override
 * @returns ImplementationResult fixture
 */
export function createImplementationOutput(
  overrides?: Partial<ImplementationResult>,
): ImplementationResult {
  return {
    modifiedFiles: ['src/services/widget.ts', 'src/models/widget.ts'],
    addedTests: ['tests/widget.test.ts'],
    duration: 5000,
    backend: 'mock-backend',
    selfCorrectionAttempts: 0,
    ...overrides,
  }
}

/**
 * Create architecture review phase output (ArchitectureReview)
 * @param overrides - Fields to override
 * @returns ArchitectureReview fixture
 */
export function createArchitectureReviewOutput(
  overrides?: Partial<ArchitectureReview>,
): ArchitectureReview {
  return {
    approved: true,
    violations: [],
    modifiedFiles: ['src/services/widget.ts'],
    ...overrides,
  }
}

/**
 * Create test verification phase output (TestReport)
 * @param overrides - Fields to override
 * @returns TestReport fixture
 */
export function createTestVerificationOutput(
  overrides?: Partial<TestReport>,
): TestReport {
  return {
    passed: true,
    testsRun: 42,
    coverage: 85.5,
    duration: 3000,
    testFailures: [],
    generatedTests: ['tests/widget.test.ts'],
    ...overrides,
  }
}

/**
 * Create UI validation phase output (UIReview)
 * @param overrides - Fields to override
 * @returns UIReview fixture
 */
export function createUIValidationOutput(
  overrides?: Partial<UIReview>,
): UIReview {
  return {
    approved: true,
    screenshots: [
      {
        route: '/widgets',
        path: '.kiro/ui-baselines/widgets.png',
        baseline: '.kiro/ui-baselines/widgets-baseline.png',
        diff: '.kiro/ui-baselines/widgets-diff.png',
      },
    ],
    uiIssues: [],
    skipped: false,
    ...overrides,
  }
}

/**
 * Create review delivery phase output (ReviewCouncilResult)
 * @param overrides - Fields to override
 * @returns ReviewCouncilResult fixture
 */
export function createReviewDeliveryOutput(
  overrides?: Partial<ReviewCouncilResult>,
): ReviewCouncilResult {
  return {
    consensus: 'passed',
    votes: [
      {
        perspective: 'security',
        approved: true,
        feedback: 'No security concerns identified',
        severity: 'low',
      },
      {
        perspective: 'performance',
        approved: true,
        feedback: 'Performance within acceptable bounds',
        severity: 'low',
      },
      {
        perspective: 'maintainability',
        approved: true,
        feedback: 'Code is well-structured',
        severity: 'low',
      },
    ],
    rounds: 1,
    cost: 0.03,
    ...overrides,
  }
}

/**
 * Create a complete set of default phase responses for all 8 phases
 * @returns Map of phase names to MockPhaseResponse configurations
 */
export function createDefaultPhaseResponses(): Map<PhaseName, MockPhaseResponse> {
  const responses = new Map<PhaseName, MockPhaseResponse>()

  responses.set('intake', {
    success: true,
    output: createIntakeOutput(),
    tokensUsed: 1000,
  })

  responses.set('validation', {
    success: true,
    output: createValidationOutput(),
    tokensUsed: 500,
  })

  responses.set('architecture-analysis', {
    success: true,
    output: createArchitectureAnalysisOutput(),
    tokensUsed: 800,
  })

  responses.set('implementation', {
    success: true,
    output: createImplementationOutput(),
    tokensUsed: 2000,
  })

  responses.set('architecture-review', {
    success: true,
    output: createArchitectureReviewOutput(),
    tokensUsed: 600,
  })

  responses.set('test-verification', {
    success: true,
    output: createTestVerificationOutput(),
    tokensUsed: 700,
  })

  responses.set('ui-validation', {
    success: true,
    output: createUIValidationOutput(),
    tokensUsed: 400,
  })

  responses.set('review-delivery', {
    success: true,
    output: createReviewDeliveryOutput(),
    tokensUsed: 900,
  })

  return responses
}

/**
 * Factory for creating custom phase response configurations
 */
export class PhaseResponseFactory {
  private responses: Map<PhaseName, MockPhaseResponse>

  constructor() {
    this.responses = createDefaultPhaseResponses()
  }

  /**
   * Set a success response for a phase
   * @param phase - Phase name
   * @param output - Phase output
   * @param tokensUsed - Tokens consumed
   */
  setSuccess(
    phase: PhaseName,
    output: Record<string, unknown>,
    tokensUsed?: number,
  ): void {
    this.responses.set(phase, {
      success: true,
      output,
      tokensUsed,
    })
  }

  /**
   * Set a failure response for a phase
   * @param phase - Phase name
   * @param error - Error message
   * @param retryable - Whether the error is retryable
   * @param tokensUsed - Tokens consumed
   */
  setFailure(
    phase: PhaseName,
    error: string,
    retryable = false,
    tokensUsed?: number,
  ): void {
    this.responses.set(phase, {
      success: false,
      error,
      retryable,
      tokensUsed,
    })
  }

  /**
   * Build the phase responses map
   * @returns Map of phase names to MockPhaseResponse
   */
  build(): Map<PhaseName, MockPhaseResponse> {
    return new Map(this.responses)
  }
}
