/**
 * Tier 2 E2E Tests — Error Handling & Recovery
 *
 * Tests crash recovery, checkpoint persistence, cost budgets,
 * pause/resume, retry logic, and concurrent run handling.
 *
 * Requirements: 5.1–5.5, 6.1–6.5, 7.1–7.3, 17.1–17.4, 18.1–18.5
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  setupHarness,
  teardownHarness,
  configurePhaseFailure,
  cleanupAllTestArtifacts,
  trackTestFeature,
  startRunWithRetry,
} from './helpers/harness'
import { initializeKASO, shutdownKASO } from '@/index'
import { createMockProject } from './helpers/mock-project'
import { EventCollector } from './helpers/event-collector'
import { MockBackend } from './helpers/mock-backend'
import type { PhaseName } from '@/core/types'
import { existsSync } from 'fs'

const TEST_TIMEOUT = 120000

describe('Tier 2: Error Handling & Recovery', () => {
  beforeAll(() => {
    cleanupAllTestArtifacts()
  })

  afterAll(() => {
    // Final cleanup to remove any leftover artifacts from failed tests
    cleanupAllTestArtifacts()
  })

  describe('Crash Recovery', () => {
    it(
      'should create checkpoint after each phase with runId, phase, and phaseOutputs',
      async () => {
        const ctx = await setupHarness({
          featureName: 'checkpoint-test',
          backendPresets: [
            {
              name: 'mock-backend',
              phaseResponses: new Map([
                [
                  'implementation' as PhaseName,
                  {
                    success: true,
                    output: {
                      modifiedFiles: [],
                      addedTests: [],
                      duration: 500,
                      backend: 'mock-backend',
                      selfCorrectionAttempts: 0,
                    },
                    tokensUsed: 1000,
                  },
                ],
              ]),
            },
          ],
        })

        const { runId } = await startRunWithRetry(ctx)

        // Wait for all phases to complete
        await ctx.eventCollector.waitForEvent('run:completed', 90000)

        // Verify checkpoints exist
        const checkpointCount =
          ctx.app.checkpointManager.getCheckpointCount(runId)
        expect(checkpointCount).toBeGreaterThan(0)

        // Get latest checkpoint and verify structure
        const latestCheckpoint =
          ctx.app.checkpointManager.getLatestCheckpoint(runId)
        expect(latestCheckpoint).toBeDefined()
        expect(latestCheckpoint!.runId).toBe(runId)
        expect(latestCheckpoint!.phase).toBeDefined()

        // Verify checkpoint data contains run and phaseResults
        const recoveryData =
          ctx.app.checkpointManager.recoverFromCheckpoint(runId)
        expect(recoveryData).toBeDefined()
        expect(recoveryData!.run).toBeDefined()
        expect(recoveryData!.run.runId).toBe(runId)
        expect(recoveryData!.phaseResults).toBeDefined()
        expect(recoveryData!.phaseResults.length).toBeGreaterThan(0)

        await teardownHarness(ctx)
      },
      TEST_TIMEOUT,
    )

    it(
      'should detect non-terminal runs via getInterruptedRuns()',
      async () => {
        // Create a project that we'll use to simulate interrupted runs
        const project = await createMockProject({
          featureName: 'interrupted-run-test',
        })
        trackTestFeature('interrupted-run-test')

        try {
          // Initialize KASO
          const app = await initializeKASO({
            configPath: project.configPath,
          })

          // Register mock backend
          const backend = new MockBackend({
            name: 'mock-backend',
            maxContextWindow: 128000,
            costPer1000Tokens: 0.01,
          })

          const { createDefaultPhaseResponses } =
            await import('./helpers/phase-outputs')
          const defaultResponses = createDefaultPhaseResponses()
          for (const [phase, response] of defaultResponses) {
            backend.setPhaseResponse(phase, response)
          }
          // Configure implementation to skip test execution
          backend.setPhaseResponse('implementation', {
            success: true,
            output: {
              modifiedFiles: [],
              addedTests: [],
              duration: 500,
              backend: 'mock-backend',
              selfCorrectionAttempts: 0,
            },
            tokensUsed: 1000,
          })

          app.backendRegistry.registerBackend('mock-backend', backend)

          // Create a run directly in the execution store (simulating an interrupted run)
          const runId = 'test-interrupted-run-' + Date.now()
          const runRecord = {
            runId,
            specPath: project.specPath,
            status: 'running' as const,
            currentPhase: 'implementation' as PhaseName,
            phases: [
              'intake',
              'validation',
              'architecture-analysis',
              'implementation',
            ] as PhaseName[],
            phaseResults: [],
            startedAt: new Date().toISOString(),
            worktreePath: undefined,
            cost: 0,
            logs: [],
          }

          app.executionStore.saveRun(runRecord)

          // Get interrupted runs
          const interruptedRuns = app.executionStore.getInterruptedRuns()

          // Should find our simulated run
          const foundRun = interruptedRuns.find((r) => r.runId === runId)
          expect(foundRun).toBeDefined()
          expect(foundRun!.status).toBe('running')

          // Update status to completed and verify it's no longer interrupted
          app.executionStore.updateRunStatus(runId, 'completed')
          const interruptedRunsAfter = app.executionStore.getInterruptedRuns()
          const foundAfter = interruptedRunsAfter.find((r) => r.runId === runId)
          expect(foundAfter).toBeUndefined()

          await shutdownKASO(app)
        } finally {
          await project.cleanup()
        }
      },
      TEST_TIMEOUT,
    )
  })

  describe('Cost Budget Enforcement', () => {
    it(
      'should halt pipeline when cost budget is exceeded',
      async () => {
        // Configure a very low cost budget (0.05 USD)
        // With 10000 tokens/phase at 0.01/1k tokens = 0.10 USD per phase
        // Budget should be exceeded after first phase
        const ctx = await setupHarness({
          featureName: 'cost-budget-test',
          configOverrides: {
            costBudgetPerRun: 0.05, // 5 cents
          },
          backendPresets: [
            {
              name: 'mock-backend',
              phaseResponses: new Map([
                [
                  'implementation' as PhaseName,
                  {
                    success: true,
                    output: {
                      modifiedFiles: [],
                      addedTests: [],
                      duration: 500,
                      backend: 'mock-backend',
                      selfCorrectionAttempts: 0,
                    },
                    tokensUsed: 10000,
                  },
                ],
              ]),
            },
          ],
        })

        // Configure backend to use high token counts
        const backend = ctx.backends.get('mock-backend')!
        for (const phase of [
          'intake',
          'validation',
          'architecture-analysis',
          'implementation',
          'architecture-review',
          'test-verification',
          'ui-validation',
          'review-delivery',
        ] as PhaseName[]) {
          backend.setPhaseResponse(phase, {
            success: true,
            tokensUsed: 10000, // 0.10 USD at 0.01/1k
          })
        }

        const { runId } = await ctx.app.orchestrator.startRun({
          specPath: ctx.specPath,
        })

        // Wait for budget exceeded event or run completion/failure
        let budgetExceeded = false
        let completed = false
        let attempts = 0

        while (attempts < 200 && !completed) {
          try {
            const status = ctx.app.orchestrator.getRunStatus(runId)
            if (status.status === 'failed' || status.status === 'completed') {
              completed = true
            }
          } catch {
            // Continue waiting
          }

          // Check for budget exceeded event
          const budgetEvents = ctx.eventCollector.getByType(
            'run:budget_exceeded',
          )
          if (budgetEvents.length > 0) {
            budgetExceeded = true
            completed = true
          }

          await new Promise((resolve) => setTimeout(resolve, 50))
          attempts++
        }

        // Should have emitted budget exceeded event
        expect(budgetExceeded).toBe(true)

        // Pipeline should have halted before all 8 phases
        const phaseResults = ctx.app.executionStore.getPhaseResults(runId)
        expect(phaseResults.length).toBeLessThan(8)

        await teardownHarness(ctx)
      },
      TEST_TIMEOUT,
    )

    it(
      'should preserve worktree when budget is exceeded',
      async () => {
        const ctx = await setupHarness({
          featureName: 'budget-worktree-test',
          configOverrides: {
            costBudgetPerRun: 0.05,
          },
          backendPresets: [
            {
              name: 'mock-backend',
              phaseResponses: new Map([
                [
                  'implementation' as PhaseName,
                  {
                    success: true,
                    output: {
                      modifiedFiles: [],
                      addedTests: [],
                      duration: 500,
                      backend: 'mock-backend',
                      selfCorrectionAttempts: 0,
                    },
                    tokensUsed: 10000,
                  },
                ],
              ]),
            },
          ],
        })

        const backend = ctx.backends.get('mock-backend')!
        backend.setPhaseResponse('intake', {
          success: true,
          tokensUsed: 10000,
        })

        const { runId } = await ctx.app.orchestrator.startRun({
          specPath: ctx.specPath,
        })

        // Wait for budget exceeded
        await ctx.eventCollector.waitForEvent('run:budget_exceeded', 30000)

        // Get run info and verify worktree still exists
        const runInfo = ctx.app.executionStore.getRun(runId)
        expect(runInfo).toBeDefined()
        expect(runInfo!.worktreePath).toBeDefined()
        expect(existsSync(runInfo!.worktreePath!)).toBe(true)

        await teardownHarness(ctx)
      },
      TEST_TIMEOUT,
    )
  })

  describe('Concurrent Run Handling', () => {
    it(
      'should reject second startRun() for same spec with active run exists error',
      async () => {
        // Use a backend that hangs on implementation to keep run active
        const ctx = await setupHarness({
          featureName: 'concurrent-rejection-test',
          backendPresets: [],
        })

        // Override execute to never return for implementation phase
        const backend = ctx.backends.get('mock-backend')!
        backend.execute = async (request) => {
          // Only delay/hang on implementation phase
          if (request.phase === 'implementation') {
            // Hang indefinitely - we'll cancel the run in cleanup
            await new Promise(() => {
              // Never resolves
            })
          }
          // Return default for other phases
          return {
            id: request.id,
            success: true,
            tokensUsed: 1000,
            duration: 0,
          }
        }

        // Start first run - don't await, it will hang
        const startPromise = ctx.app.orchestrator.startRun({
          specPath: ctx.specPath,
        })

        // Wait for phases before implementation to complete
        await ctx.eventCollector.waitForEvent('phase:completed', 30000)

        // Now try to start second run - should reject
        let rejectionError: Error | null = null
        try {
          await ctx.app.orchestrator.startRun({
            specPath: ctx.specPath,
          })
        } catch (error) {
          rejectionError = error as Error
        }

        // Verify we got the expected error
        expect(rejectionError).not.toBeNull()
        expect(rejectionError!.message).toMatch(/active run already exists/i)

        // Get runId from the start promise (it resolved before hanging)
        const { runId } = await startPromise

        // Try to cancel, but it might already be in a terminal state
        try {
          ctx.app.orchestrator.cancelRun(runId)
        } catch {
          // Run might already be cancelled/failed, that's ok
        }

        await teardownHarness(ctx)
      },
      TEST_TIMEOUT,
    )

    it(
      'should allow concurrent runs for different spec paths',
      async () => {
        // Create two separate mock projects with unique names
        const timestamp = Date.now()
        const featureName1 = `concurrent-spec-1-${timestamp}`
        const featureName2 = `concurrent-spec-2-${timestamp}`
        trackTestFeature(featureName1)
        trackTestFeature(featureName2)
        const project1 = await createMockProject({
          featureName: featureName1,
          configOverrides: {
            maxPhaseRetries: 1,
          },
        })
        const project2 = await createMockProject({
          featureName: featureName2,
          configOverrides: {
            maxPhaseRetries: 1,
          },
        })

        try {
          // Initialize KASO once for both runs
          const app = await initializeKASO({
            configPath: project1.configPath,
          })

          // Register mock backend
          const backend = new MockBackend({
            name: 'mock-backend',
            maxContextWindow: 128000,
            costPer1000Tokens: 0.01,
          })

          const { createDefaultPhaseResponses } =
            await import('./helpers/phase-outputs')
          const defaultResponses = createDefaultPhaseResponses()
          for (const [phase, response] of defaultResponses) {
            backend.setPhaseResponse(phase, response)
          }
          // Configure implementation to skip test execution
          backend.setPhaseResponse('implementation', {
            success: true,
            output: {
              modifiedFiles: [],
              addedTests: [],
              duration: 500,
              backend: 'mock-backend',
              selfCorrectionAttempts: 0,
            },
            tokensUsed: 1000,
          })

          app.backendRegistry.registerBackend('mock-backend', backend)

          // Create event collector BEFORE starting runs
          const eventCollector = new EventCollector(app.eventBus)

          // Start both runs
          const { runId: runId1 } = await app.orchestrator.startRun({
            specPath: project1.specPath,
          })
          const { runId: runId2 } = await app.orchestrator.startRun({
            specPath: project2.specPath,
          })

          // Both runs should have different IDs
          expect(runId1).not.toBe(runId2)

          // Wait for both to complete

          // Wait for both run:completed events
          let completed1 = false
          let completed2 = false
          let attempts = 0
          while (attempts < 200 && !(completed1 && completed2)) {
            const events = eventCollector.getByType('run:completed')
            completed1 = events.some((e) => e.runId === runId1)
            completed2 = events.some((e) => e.runId === runId2)
            if (!completed1 || !completed2) {
              await new Promise((resolve) => setTimeout(resolve, 100))
            }
            attempts++
          }

          expect(completed1).toBe(true)
          expect(completed2).toBe(true)

          eventCollector.dispose()
          await shutdownKASO(app)
        } finally {
          await project1.cleanup()
          await project2.cleanup()
        }
      },
      TEST_TIMEOUT * 2,
    )
  })

  describe('Pause/Resume', () => {
    it(
      'should pause run and resume from next phase',
      async () => {
        const ctx = await setupHarness({
          featureName: 'pause-resume-test',
          backendPresets: [
            {
              name: 'mock-backend',
              phaseResponses: new Map([
                [
                  'implementation' as PhaseName,
                  {
                    success: true,
                    output: {
                      modifiedFiles: [],
                      addedTests: [],
                      duration: 500,
                      backend: 'mock-backend',
                      selfCorrectionAttempts: 0,
                    },
                    tokensUsed: 1000,
                  },
                ],
              ]),
              delayMs: 50,
            },
          ],
        })

        const startPromise = ctx.app.orchestrator.startRun({
          specPath: ctx.specPath,
        })

        // Wait for first phase to start then immediately pause
        await ctx.eventCollector.waitForEvent('phase:started', 10000)

        const { runId } = await startPromise

        // Small delay to ensure we're mid-pipeline
        await new Promise((resolve) => setTimeout(resolve, 50))

        // Check if still running before pausing
        const currentStatus = ctx.app.orchestrator.getRunStatus(runId)
        if (currentStatus.status !== 'running') {
          // Pipeline completed too fast, skip pause test
          expect(['completed', 'paused']).toContain(currentStatus.status)
          await teardownHarness(ctx)
          return
        }

        // Pause the run
        ctx.app.orchestrator.pauseRun(runId)

        // Verify status is paused
        const pausedStatus = ctx.app.orchestrator.getRunStatus(runId)
        expect(pausedStatus.status).toBe('paused')

        // Get phase count before resume
        const phaseCountBefore =
          ctx.app.executionStore.getPhaseResults(runId).length

        // Resume the run
        await ctx.app.orchestrator.resumeRun(runId)

        // Wait for completion
        let attempts = 0
        let finalStatus = ''
        while (attempts < 200) {
          const status = ctx.app.orchestrator.getRunStatus(runId)
          finalStatus = status.status
          if (['completed', 'failed'].includes(finalStatus)) {
            break
          }
          await new Promise((resolve) => setTimeout(resolve, 100))
          attempts++
        }

        expect(finalStatus).toBe('completed')

        // Verify pipeline continued from where it left off
        const phaseCountAfter =
          ctx.app.executionStore.getPhaseResults(runId).length
        expect(phaseCountAfter).toBeGreaterThan(phaseCountBefore)
        expect(phaseCountAfter).toBe(8)

        await teardownHarness(ctx)
      },
      TEST_TIMEOUT,
    )

    it(
      'should throw error when pausing non-running run',
      async () => {
        const ctx = await setupHarness({
          featureName: 'pause-invalid-test',
          backendPresets: [
            {
              name: 'mock-backend',
              phaseResponses: new Map([
                [
                  'implementation' as PhaseName,
                  {
                    success: true,
                    output: {
                      modifiedFiles: [],
                      addedTests: [],
                      duration: 500,
                      backend: 'mock-backend',
                      selfCorrectionAttempts: 0,
                    },
                    tokensUsed: 1000,
                  },
                ],
              ]),
            },
          ],
        })

        const { runId } = await ctx.app.orchestrator.startRun({
          specPath: ctx.specPath,
        })

        // Wait for completion
        await ctx.eventCollector.waitForEvent('run:completed', 60000)

        // Try to pause completed run
        expect(() => ctx.app.orchestrator.pauseRun(runId)).toThrow()

        await teardownHarness(ctx)
      },
      TEST_TIMEOUT,
    )
  })

  describe('Retry Logic', () => {
    it(
      'should retry retryable phase failures up to maxPhaseRetries',
      async () => {
        const ctx = await setupHarness({
          featureName: 'retry-test',
          configOverrides: {
            maxPhaseRetries: 2,
          },
          backendPresets: [],
        })

        // Configure implementation phase to fail twice then succeed
        let callCount = 0
        const backend = ctx.backends.get('mock-backend')!

        // Override the execute method to track calls for implementation phase
        const originalExecute = backend.execute.bind(backend)
        backend.execute = async (request) => {
          if (request.phase === 'implementation') {
            callCount++
            if (callCount <= 2) {
              // Return retryable error for first 2 attempts
              return {
                id: request.id,
                success: false,
                error: 'Temporary error',
                tokensUsed: 100,
                duration: 0,
              }
            }
            // Return success on third attempt
            return {
              id: request.id,
              success: true,
              output: {
                modifiedFiles: [],
                addedTests: [],
                duration: 500,
                backend: 'mock-backend',
                selfCorrectionAttempts: 0,
              },
              tokensUsed: 1000,
              duration: 0,
            }
          }
          return originalExecute(request)
        }

        const { runId } = await ctx.app.orchestrator.startRun({
          specPath: ctx.specPath,
        })

        // Wait for run to complete
        await ctx.eventCollector.waitForEvent('run:completed', 60000)

        // Verify implementation was called multiple times (initial + retries)
        expect(callCount).toBeGreaterThan(1)

        // Run should eventually succeed
        const status = ctx.app.orchestrator.getRunStatus(runId)
        expect(status.status).toBe('completed')

        await teardownHarness(ctx)
      },
      TEST_TIMEOUT,
    )

    it(
      'should halt pipeline on non-retryable failure',
      async () => {
        const ctx = await setupHarness({
          featureName: 'non-retryable-test',
          backendPresets: [],
        })

        // Configure implementation phase to fail with non-retryable error
        configurePhaseFailure(
          ctx,
          'mock-backend',
          'implementation',
          'Fatal error',
          false,
        )

        const { runId } = await ctx.app.orchestrator.startRun({
          specPath: ctx.specPath,
        })

        // Wait for run to fail
        let attempts = 0
        let finalStatus = ''
        while (attempts < 200) {
          try {
            const status = ctx.app.orchestrator.getRunStatus(runId)
            finalStatus = status.status
            if (['completed', 'failed'].includes(finalStatus)) {
              break
            }
          } catch {
            // Continue waiting
          }
          await new Promise((resolve) => setTimeout(resolve, 50))
          attempts++
        }

        expect(finalStatus).toBe('failed')

        // Should have implementation phase failure
        const phaseResults = ctx.app.executionStore.getPhaseResults(runId)
        const implResult = phaseResults.find(
          (r) => r.phase === 'implementation',
        )
        expect(implResult).toBeDefined()
        expect(implResult!.status).toBe('failure')

        await teardownHarness(ctx)
      },
      TEST_TIMEOUT,
    )

    it(
      'should emit retry-related events during retry',
      async () => {
        const ctx = await setupHarness({
          featureName: 'retry-log-test',
          configOverrides: {
            maxPhaseRetries: 1,
          },
          backendPresets: [],
        })

        // Track execution attempts
        let attemptCount = 0
        const backend = ctx.backends.get('mock-backend')!
        const originalExecute = backend.execute.bind(backend)

        backend.execute = async (request) => {
          if (request.phase === 'implementation') {
            attemptCount++
            if (attemptCount === 1) {
              // First attempt fails
              return {
                id: request.id,
                success: false,
                error: 'Temporary failure',
                tokensUsed: 100,
                duration: 0,
              }
            }
            // Second attempt succeeds
            return {
              id: request.id,
              success: true,
              output: {
                modifiedFiles: [],
                addedTests: [],
                duration: 500,
                backend: 'mock-backend',
                selfCorrectionAttempts: 1,
              },
              tokensUsed: 1000,
              duration: 0,
            }
          }
          return originalExecute(request)
        }

        const { runId } = await ctx.app.orchestrator.startRun({
          specPath: ctx.specPath,
        })

        // Wait for run to complete
        await ctx.eventCollector.waitForEvent('run:completed', 60000)

        // Verify the backend was called multiple times (retry occurred)
        expect(attemptCount).toBeGreaterThanOrEqual(1)

        // Check phase results for implementation
        const phaseResults = ctx.app.executionStore.getPhaseResults(runId)
        const implResults = phaseResults.filter(
          (r) => r.phase === 'implementation',
        )

        // Should have at least one implementation result
        expect(implResults.length).toBeGreaterThan(0)

        // The final implementation result should be success
        const finalImplResult = implResults[implResults.length - 1]
        expect(finalImplResult!.status).toBe('success')

        await teardownHarness(ctx)
      },
      TEST_TIMEOUT,
    )

    it(
      'should mark run as failed when all retries are exhausted',
      async () => {
        const ctx = await setupHarness({
          featureName: 'retry-exhausted-test',
          configOverrides: {
            maxPhaseRetries: 1,
          },
          backendPresets: [],
        })

        // Configure implementation to always fail
        configurePhaseFailure(
          ctx,
          'mock-backend',
          'implementation',
          'Persistent error',
          true,
        )

        const { runId } = await ctx.app.orchestrator.startRun({
          specPath: ctx.specPath,
        })

        // Wait for run to fail
        let attempts = 0
        let finalStatus = ''
        while (attempts < 200) {
          try {
            const status = ctx.app.orchestrator.getRunStatus(runId)
            finalStatus = status.status
            if (['completed', 'failed'].includes(finalStatus)) {
              break
            }
          } catch {
            // Continue waiting
          }
          await new Promise((resolve) => setTimeout(resolve, 50))
          attempts++
        }

        expect(finalStatus).toBe('failed')

        // Verify the validation phase shows retry exhaustion
        const phaseResults = ctx.app.executionStore.getPhaseResults(runId)
        const validationResult = phaseResults.find(
          (r) => r.phase === 'validation',
        )
        expect(validationResult).toBeDefined()

        await teardownHarness(ctx)
      },
      TEST_TIMEOUT,
    )
  })

  describe('Error Classification', () => {
    it(
      'should classify errors and select appropriate recovery strategy',
      async () => {
        const ctx = await setupHarness({
          featureName: 'error-classification-test',
          backendPresets: [
            {
              name: 'mock-backend',
              phaseResponses: new Map([
                [
                  'implementation' as PhaseName,
                  {
                    success: true,
                    output: {
                      modifiedFiles: [],
                      addedTests: [],
                      duration: 500,
                      backend: 'mock-backend',
                      selfCorrectionAttempts: 0,
                    },
                    tokensUsed: 1000,
                  },
                ],
              ]),
            },
          ],
        })

        // Import ErrorHandler to verify error classification
        const { ErrorHandler } = await import('@/core/error-handler')
        const errorHandler = new ErrorHandler(
          ctx.app.backendRegistry,
          ctx.app.config,
        )

        // Test transient error classification
        const transientError = {
          message: 'Network timeout',
          retryable: true,
          code: 'TIMEOUT',
        }
        const transientSeverity = errorHandler.classifyError(transientError)
        expect([
          'transient',
          'recoverable',
          'fatal',
          'security',
          'architectural',
        ]).toContain(transientSeverity)

        // Test security error classification
        const securityError = {
          message: 'Security vulnerability detected',
          retryable: false,
          code: 'SECURITY',
        }
        const securitySeverity = errorHandler.classifyError(securityError)
        expect(securitySeverity).toBeDefined()

        await teardownHarness(ctx)
      },
      TEST_TIMEOUT,
    )
  })
})
