/**
 * Unit Tests for PhaseOutputs Helper
 *
 * Validates the phase output fixture factories.
 * Requirements: 4.1–4.8
 */

import { describe, it, expect } from 'vitest'
import {
  createMockParsedMarkdown,
  createMockTaskItems,
  createIntakeOutput,
  createValidationOutput,
  createArchitectureAnalysisOutput,
  createImplementationOutput,
  createArchitectureReviewOutput,
  createTestVerificationOutput,
  createUIValidationOutput,
  createReviewDeliveryOutput,
  createDefaultPhaseResponses,
  PhaseResponseFactory,
} from './phase-outputs'
import type { PhaseName } from '@/core/types'

describe('Phase Output Factories', () => {
  describe('createMockParsedMarkdown', () => {
    it('should create valid ParsedMarkdown', () => {
      const md = createMockParsedMarkdown('Test Title')

      expect(md.rawContent).toContain('Test Title')
      expect(md.sections).toHaveLength(1)
      expect(md.sections[0]?.title).toBe('Test Title')
      expect(md.codeBlocks).toEqual([])
      expect(md.metadata).toEqual({})
    })
  })

  describe('createMockTaskItems', () => {
    it('should create valid TaskItems', () => {
      const tasks = createMockTaskItems()

      expect(tasks.length).toBeGreaterThan(0)
      expect(tasks[0]).toHaveProperty('id')
      expect(tasks[0]).toHaveProperty('title')
      expect(tasks[0]).toHaveProperty('status')
    })
  })

  describe('createIntakeOutput', () => {
    it('should create valid AssembledContext', () => {
      const output = createIntakeOutput()

      expect(output.featureName).toBe('mock-feature')
      expect(output.designDoc).toBeDefined()
      expect(output.taskList).toBeDefined()
      expect(output.architectureDocs).toEqual({})
      expect(output.removedFiles).toEqual([])
    })

    it('should apply overrides', () => {
      const output = createIntakeOutput({ featureName: 'custom-feature' })

      expect(output.featureName).toBe('custom-feature')
    })
  })

  describe('createValidationOutput', () => {
    it('should create valid ValidationReport', () => {
      const output = createValidationOutput()

      expect(output.approved).toBe(true)
      expect(output.issues).toEqual([])
      expect(output.suggestedFixes).toEqual([])
    })
  })

  describe('createArchitectureAnalysisOutput', () => {
    it('should create valid ArchitectureContext', () => {
      const output = createArchitectureAnalysisOutput()

      expect(output.patterns).toBeDefined()
      expect(output.moduleBoundaries).toBeDefined()
      expect(output.adrsFound).toBe(0)
    })
  })

  describe('createImplementationOutput', () => {
    it('should create valid ImplementationResult', () => {
      const output = createImplementationOutput()

      expect(output.modifiedFiles).toContain('src/services/widget.ts')
      expect(output.addedTests).toContain('tests/widget.test.ts')
      expect(output.duration).toBe(5000)
      expect(output.backend).toBe('mock-backend')
      expect(output.selfCorrectionAttempts).toBe(0)
    })
  })

  describe('createArchitectureReviewOutput', () => {
    it('should create valid ArchitectureReview', () => {
      const output = createArchitectureReviewOutput()

      expect(output.approved).toBe(true)
      expect(output.violations).toEqual([])
    })
  })

  describe('createTestVerificationOutput', () => {
    it('should create valid TestReport', () => {
      const output = createTestVerificationOutput()

      expect(output.passed).toBe(true)
      expect(output.testsRun).toBe(42)
      expect(output.coverage).toBe(85.5)
      expect(output.testFailures).toEqual([])
    })
  })

  describe('createUIValidationOutput', () => {
    it('should create valid UIReview', () => {
      const output = createUIValidationOutput()

      expect(output.approved).toBe(true)
      expect(output.screenshots).toBeDefined()
      expect(output.uiIssues).toEqual([])
    })
  })

  describe('createReviewDeliveryOutput', () => {
    it('should create valid ReviewCouncilResult', () => {
      const output = createReviewDeliveryOutput()

      expect(output.consensus).toBe('passed')
      expect(output.votes).toHaveLength(3)
      expect(output.rounds).toBe(1)
      expect(output.votes[0]).toHaveProperty('perspective')
      expect(output.votes[0]).toHaveProperty('approved')
    })
  })

  describe('createDefaultPhaseResponses', () => {
    it('should create responses for all 8 phases', () => {
      const responses = createDefaultPhaseResponses()

      const expectedPhases: PhaseName[] = [
        'intake',
        'validation',
        'architecture-analysis',
        'implementation',
        'architecture-review',
        'test-verification',
        'ui-validation',
        'review-delivery',
      ]

      for (const phase of expectedPhases) {
        expect(responses.has(phase)).toBe(true)
        const response = responses.get(phase)
        expect(response?.success).toBe(true)
        expect(response?.tokensUsed).toBeDefined()
      }
    })
  })

  describe('PhaseResponseFactory', () => {
    it('should build default responses', () => {
      const factory = new PhaseResponseFactory()
      const responses = factory.build()

      expect(responses.size).toBe(8)
    })

    it('should set success responses', () => {
      const factory = new PhaseResponseFactory()
      factory.setSuccess('implementation', { modifiedFiles: ['custom.ts'] }, 1500)

      const responses = factory.build()
      const impl = responses.get('implementation')

      expect(impl?.success).toBe(true)
      expect(impl?.output).toEqual({ modifiedFiles: ['custom.ts'] })
      expect(impl?.tokensUsed).toBe(1500)
    })

    it('should set failure responses', () => {
      const factory = new PhaseResponseFactory()
      factory.setFailure('validation', 'Schema error', true, 200)

      const responses = factory.build()
      const validation = responses.get('validation')

      expect(validation?.success).toBe(false)
      expect(validation?.error).toBe('Schema error')
      expect(validation?.retryable).toBe(true)
    })
  })
})
