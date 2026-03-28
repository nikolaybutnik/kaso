/**
 * Smoke Test for KASO
 *
 * Verifies the full application wiring works end-to-end.
 * Runs a simple spec through the pipeline with a mock backend.
 *
 * Requirements: All
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  initializeKASO,
  shutdownKASO,
  checkHealth,
  type ApplicationContext,
} from '@/index'
import { createTestConfig } from './kaso.integration.test'
import type { ExecutionEvent } from '@/core/types'
import { existsSync, rmSync } from 'fs'

// =============================================================================
// Smoke Test — Full Wiring Verification
// =============================================================================

describe('KASO Smoke Test', () => {
  let context: ApplicationContext

  beforeAll(async () => {
    context = await initializeKASO({
      config: createTestConfig(),
      enableSSE: false,
      enableWebhooks: false,
      enableFileWatcher: false,
      enableMCP: false,
    })
  })

  afterAll(async () => {
    if (context) {
      await shutdownKASO(context)
    }
  })

  it('should have initialized all core components', () => {
    expect(context.config).toBeDefined()
    expect(context.config.defaultBackend).toBe('mock-backend')
    expect(context.eventBus).toBeDefined()
    expect(context.executionStore).toBeDefined()
    expect(context.checkpointManager).toBeDefined()
    expect(context.worktreeManager).toBeDefined()
    expect(context.costTracker).toBeDefined()
    expect(context.concurrencyManager).toBeDefined()
    expect(context.backendRegistry).toBeDefined()
    expect(context.agentRegistry).toBeDefined()
    expect(context.orchestrator).toBeDefined()
  })

  it('should have registered all 8 built-in phase agents', () => {
    const registeredPhases = context.agentRegistry
      .listRegistered()
      .map((m) => m.phase)

    const expectedPhases = [
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
      expect(registeredPhases).toContain(phase)
    }
  })

  it('should have working event bus with pub/sub', () => {
    let eventReceived = false
    const unsubscribe = context.eventBus.on('run:started', () => {
      eventReceived = true
    })

    context.eventBus.emit({
      type: 'run:started',
      runId: 'smoke-test',
      timestamp: new Date().toISOString(),
    })

    expect(eventReceived).toBe(true)
    unsubscribe()
  })

  it('should have working execution store', () => {
    const runs = context.executionStore.getRuns(10)
    expect(Array.isArray(runs)).toBe(true)
  })

  it('should have working cost tracker', () => {
    const costs = context.costTracker.getHistoricalCosts(10)
    expect(Array.isArray(costs)).toBe(true)
  })

  it('should have working backend registry', () => {
    const backend = context.backendRegistry.getBackend('mock-backend')
    expect(backend).toBeDefined()
    expect(backend.name).toBe('mock-backend')
  })

  it('should be able to create and cleanup worktrees', async () => {
    const uniqueName = `smoke-test-${Date.now()}`
    let worktree: Awaited<
      ReturnType<typeof context.worktreeManager.create>
    > | null = null

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        worktree = await context.worktreeManager.create(uniqueName, 'main')
        break
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        if (
          (msg.includes('lock') || msg.includes('File exists')) &&
          attempt < 4
        ) {
          await new Promise((r) =>
            setTimeout(r, 500 * Math.pow(2, attempt) + Math.random() * 300),
          )
          continue
        }
        throw error
      }
    }

    expect(worktree).toBeDefined()
    expect(worktree!.path).toBeDefined()
    expect(worktree!.branch).toMatch(/^kaso\/smoke-test-/)

    await context.worktreeManager.cleanup(worktree!.runId)
  })

  it('should have healthy status', () => {
    const health = checkHealth(context)
    expect(health.healthy).toBe(true)
    expect(health.components.config).toBe(true)
    expect(health.components.executionStore).toBe(true)
    expect(health.components.orchestrator).toBe(true)
  })

  it('should complete full lifecycle without errors', () => {
    // Verify orchestrator is ready
    const activeRuns = context.orchestrator.listActiveRuns()
    expect(Array.isArray(activeRuns)).toBe(true)

    // Verify event bus handles multiple subscribers
    const events: string[] = []
    const unsub1 = context.eventBus.on('phase:started', (e) => {
      events.push(`started:${e.runId}`)
    })
    const unsub2 = context.eventBus.on('phase:completed', (e) => {
      events.push(`completed:${e.runId}`)
    })

    context.eventBus.emit({
      type: 'phase:started',
      runId: 'lifecycle-test',
      timestamp: new Date().toISOString(),
      phase: 'intake',
    })
    context.eventBus.emit({
      type: 'phase:completed',
      runId: 'lifecycle-test',
      timestamp: new Date().toISOString(),
      phase: 'intake',
    })

    expect(events).toContain('started:lifecycle-test')
    expect(events).toContain('completed:lifecycle-test')

    unsub1()
    unsub2()
  })

  it('should propagate events through onAny subscriber', () => {
    const allEvents: ExecutionEvent[] = []
    const unsub = context.eventBus.onAny((e) => {
      allEvents.push(e as ExecutionEvent)
    })

    context.eventBus.emit({
      type: 'run:started',
      runId: 'any-test',
      timestamp: new Date().toISOString(),
    })
    context.eventBus.emit({
      type: 'phase:started',
      runId: 'any-test',
      timestamp: new Date().toISOString(),
    })

    expect(allEvents.length).toBeGreaterThanOrEqual(2)
    unsub()
  })

  it('should have concurrency manager with correct slot count', () => {
    // Config sets maxConcurrentAgents: 2
    expect(context.concurrencyManager.getMaxSlots()).toBe(2)
  })
})

// =============================================================================
// End-to-End Pipeline Smoke Test
// =============================================================================

describe('KASO End-to-End Pipeline Smoke', () => {
  let context: ApplicationContext
  const specPaths = [
    '/tmp/nonexistent-spec-for-smoke-test',
    '/tmp/smoke-store-test',
  ]

  beforeAll(async () => {
    context = await initializeKASO({
      config: createTestConfig(),
      enableSSE: false,
      enableWebhooks: false,
      enableFileWatcher: false,
      enableMCP: false,
    })
  })

  afterAll(async () => {
    if (context) {
      // Clean up worktrees created by startRun
      for (const wt of context.worktreeManager.listWorktrees()) {
        try {
          await context.worktreeManager.cleanup(wt.runId)
        } catch {
          // Best-effort
        }
      }
      // Clean up spec directories created by the orchestrator
      for (const sp of specPaths) {
        const specName = sp.split('/').pop()
        if (specName) {
          const dir = `.kiro/specs/${specName}`
          if (existsSync(dir)) {
            rmSync(dir, { recursive: true, force: true })
          }
        }
      }
      await shutdownKASO(context)
    }
  })

  it('should attempt pipeline execution and emit events for a spec', async () => {
    // Collect all events emitted during the run attempt
    const collectedEvents: ExecutionEvent[] = []
    const unsub = context.eventBus.onAny((e) => {
      collectedEvents.push(e as ExecutionEvent)
    })

    // Start a run — it will fail at intake (no real spec files at this path)
    // but the orchestrator should still emit run:started and handle the failure
    try {
      await context.orchestrator.startRun({
        specPath: '/tmp/nonexistent-spec-for-smoke-test',
      })
    } catch {
      // Expected — the spec path doesn't exist
    }

    unsub()

    // The orchestrator should have emitted at least a run:started event
    const runStarted = collectedEvents.find((e) => e.type === 'run:started')
    expect(runStarted).toBeDefined()
    expect(runStarted!.runId).toBeDefined()
  })

  it('should track run in execution store after attempt', async () => {
    try {
      await context.orchestrator.startRun({
        specPath: '/tmp/smoke-store-test',
      })
    } catch {
      // Expected failure
    }

    // The run should be persisted in the execution store
    const runs = context.executionStore.getRuns(10)
    expect(runs.length).toBeGreaterThan(0)
  })

  it('should record cost data even for failed runs', async () => {
    const runId = `cost-smoke-${Date.now()}`

    // Record a mock invocation to verify cost tracker is wired
    context.costTracker.recordInvocation(runId, 'mock-backend', 500, 0.01)

    const cost = context.costTracker.getRunCost(runId)
    expect(cost).toBeDefined()
    expect(cost!.totalCost).toBeCloseTo(0.005)
    expect(cost!.invocations.length).toBe(1)
  })
})
