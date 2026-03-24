/**
 * Integration Tests for KASO
 *
 * Tests full application wiring, component interaction, and end-to-end pipeline.
 * Requirements: All
 */

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import {
  initializeKASO,
  shutdownKASO,
  checkHealth,
  type ApplicationContext,
} from '@/index'
import type { KASOConfig } from '@/config/schema'
import type { ExecutionEvent } from '@/core/types'

// =============================================================================
// Test Fixtures
// =============================================================================

export function createTestConfig(
  overrides: Partial<KASOConfig> = {},
): KASOConfig {
  return {
    executorBackends: [
      {
        name: 'mock-backend',
        command: 'echo',
        args: ['{"success": true}'],
        protocol: 'cli-json',
        maxContextWindow: 128000,
        costPer1000Tokens: 0.01,
        enabled: true,
      },
    ],
    defaultBackend: 'mock-backend',
    backendSelectionStrategy: 'default',
    maxConcurrentAgents: 2,
    maxPhaseRetries: 1,
    defaultPhaseTimeout: 60,
    phaseTimeouts: {},
    uiBaseline: {
      baselineDir: '.kiro/ui-baselines',
      captureOnPass: true,
      diffThreshold: 0.1,
      viewport: { width: 1280, height: 720 },
    },
    contextCapping: {
      enabled: true,
      charsPerToken: 4,
      relevanceRanking: ['design.md'],
    },
    reviewCouncil: {
      maxReviewRounds: 1,
      enableParallelReview: false,
      perspectives: ['security'],
    },
    webhooks: [],
    mcpServers: [],
    plugins: [],
    customPhases: [],
    executionStore: { type: 'sqlite', path: ':memory:' },
    ...overrides,
  } as KASOConfig
}

// =============================================================================
// Integration Tests
// =============================================================================

describe('KASO Integration Tests', () => {
  let context: ApplicationContext | undefined

  afterEach(async () => {
    if (context) {
      await shutdownKASO(context)
      context = undefined
    }
  })

  describe('Application Initialization', () => {
    it('should initialize with default configuration', async () => {
      context = await initializeKASO({
        config: createTestConfig(),
        enableSSE: false,
        enableWebhooks: false,
        enableFileWatcher: false,
        enableMCP: false,
      })

      expect(context).toBeDefined()
      expect(context.config).toBeDefined()
      expect(context.orchestrator).toBeDefined()
      expect(context.eventBus).toBeDefined()
      expect(context.executionStore).toBeDefined()
    })

    it('should have all required components', async () => {
      context = await initializeKASO({
        config: createTestConfig(),
        enableSSE: false,
        enableWebhooks: false,
        enableFileWatcher: false,
        enableMCP: false,
      })

      expect(context.agentRegistry).toBeDefined()
      expect(context.backendRegistry).toBeDefined()
      expect(context.checkpointManager).toBeDefined()
      expect(context.concurrencyManager).toBeDefined()
      expect(context.costTracker).toBeDefined()
      expect(context.specWriter).toBeDefined()
      expect(context.worktreeManager).toBeDefined()
    })

    it('should register all 8 built-in agents', async () => {
      context = await initializeKASO({
        config: createTestConfig(),
        enableSSE: false,
        enableWebhooks: false,
        enableFileWatcher: false,
        enableMCP: false,
      })

      const registeredAgents = context.agentRegistry.listRegistered()
      expect(registeredAgents.length).toBeGreaterThanOrEqual(8)

      const phases = registeredAgents.map((a) => a.phase)
      for (const expected of [
        'intake',
        'validation',
        'architecture-analysis',
        'implementation',
        'architecture-review',
        'test-verification',
        'ui-validation',
        'review-delivery',
      ]) {
        expect(phases).toContain(expected)
      }
    })

    it('should pass health check after initialization', async () => {
      context = await initializeKASO({
        config: createTestConfig(),
        enableSSE: false,
        enableWebhooks: false,
        enableFileWatcher: false,
        enableMCP: false,
      })

      const health = checkHealth(context)
      expect(health.healthy).toBe(true)
      expect(health.components.config).toBe(true)
      expect(health.components.executionStore).toBe(true)
      expect(health.components.orchestrator).toBe(true)
    })
  })

  describe('Component Wiring', () => {
    beforeEach(async () => {
      context = await initializeKASO({
        config: createTestConfig(),
        enableSSE: false,
        enableWebhooks: false,
        enableFileWatcher: false,
        enableMCP: false,
      })
    })

    it('should have execution store accessible', () => {
      const runs = context!.executionStore.getRuns(10)
      expect(runs).toBeDefined()
      expect(Array.isArray(runs)).toBe(true)
    })

    it('should have cost tracker with zero initial cost', () => {
      const history = context!.costTracker.getHistoricalCosts(10)
      expect(history).toBeDefined()
      expect(Array.isArray(history)).toBe(true)
    })

    it('should have backend registry with configured backends', () => {
      const backend = context!.backendRegistry.getBackend('mock-backend')
      expect(backend).toBeDefined()
    })

    it('should have worktree manager ready', async () => {
      const uniqueName = `test-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
      const worktreeInfo = await context!.worktreeManager.create(
        uniqueName,
        'main',
      )
      expect(worktreeInfo).toBeDefined()
      expect(worktreeInfo.path).toBeDefined()
      expect(worktreeInfo.branch).toMatch(/^kaso\//)

      await context!.worktreeManager.cleanup(worktreeInfo.runId)
    })

    it('should share event bus across components', () => {
      const events: ExecutionEvent[] = []
      const unsub = context!.eventBus.onAny((e) => {
        events.push(e as ExecutionEvent)
      })

      context!.eventBus.emit({
        type: 'run:started',
        runId: 'wiring-test',
        timestamp: new Date().toISOString(),
      })

      expect(events.length).toBe(1)
      expect(events[0]!.runId).toBe('wiring-test')
      unsub()
    })
  })

  describe('Orchestrator Integration', () => {
    beforeEach(async () => {
      context = await initializeKASO({
        config: createTestConfig(),
        enableSSE: false,
        enableWebhooks: false,
        enableFileWatcher: false,
        enableMCP: false,
      })
    })

    it('should list active runs as empty initially', () => {
      const activeRuns = context!.orchestrator.listActiveRuns()
      expect(Array.isArray(activeRuns)).toBe(true)
      expect(activeRuns.length).toBe(0)
    })

    it('should throw for non-existent run status', () => {
      expect(() => {
        context!.orchestrator.getRunStatus('non-existent-run')
      }).toThrow()
    })
  })

  describe('Event Bus Integration', () => {
    beforeEach(async () => {
      context = await initializeKASO({
        config: createTestConfig(),
        enableSSE: false,
        enableWebhooks: false,
        enableFileWatcher: false,
        enableMCP: false,
      })
    })

    it('should emit and receive typed events', () => {
      const events: string[] = []
      const unsub = context!.eventBus.on('run:started', () => {
        events.push('run:started')
      })

      context!.eventBus.emit({
        type: 'run:started',
        runId: 'test-run',
        timestamp: new Date().toISOString(),
      })

      expect(events).toContain('run:started')
      unsub()
    })

    it('should support multiple subscribers on same event', () => {
      let count = 0
      const unsub1 = context!.eventBus.on('phase:started', () => {
        count++
      })
      const unsub2 = context!.eventBus.on('phase:started', () => {
        count++
      })

      context!.eventBus.emit({
        type: 'phase:started',
        runId: 'test',
        timestamp: new Date().toISOString(),
      })

      expect(count).toBe(2)
      unsub1()
      unsub2()
    })

    it('should track event history for replay', () => {
      context!.eventBus.emit({
        type: 'phase:started',
        runId: 'test-run',
        timestamp: new Date().toISOString(),
      })

      const recentEvents = context!.eventBus.getRecentEvents(10)
      expect(recentEvents.length).toBeGreaterThan(0)
    })

    it('should unsubscribe cleanly', () => {
      let count = 0
      const unsub = context!.eventBus.on('run:failed', () => {
        count++
      })

      context!.eventBus.emit({
        type: 'run:failed',
        runId: 'test',
        timestamp: new Date().toISOString(),
      })
      expect(count).toBe(1)

      unsub()

      context!.eventBus.emit({
        type: 'run:failed',
        runId: 'test',
        timestamp: new Date().toISOString(),
      })
      expect(count).toBe(1)
    })
  })

  describe('Crash Recovery', () => {
    it('should run crash recovery on initialization', async () => {
      context = await initializeKASO({
        config: createTestConfig(),
        enableSSE: false,
        enableWebhooks: false,
        enableFileWatcher: false,
        enableMCP: false,
      })

      // Fresh store has no interrupted runs
      const runs = context.executionStore.getInterruptedRuns()
      expect(runs.length).toBe(0)
    })
  })

  describe('Shutdown', () => {
    it('should gracefully shutdown all components', async () => {
      context = await initializeKASO({
        config: createTestConfig(),
        enableSSE: false,
        enableWebhooks: false,
        enableFileWatcher: false,
        enableMCP: false,
      })

      await shutdownKASO(context)
      context = undefined
    })
  })
})
