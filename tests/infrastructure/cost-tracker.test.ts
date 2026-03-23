import { describe, it, expect } from 'vitest'
import { CostTracker } from '@/infrastructure/cost-tracker'

describe('CostTracker', () => {
  describe('recordInvocation', () => {
    it('should record invocation cost correctly', () => {
      const tracker = new CostTracker()
      const runId = 'test-run-1'

      const cost = tracker.recordInvocation(runId, 'kimi-code', 1500, 0.01)

      expect(cost).toBe((1500 / 1000) * 0.01) // 0.015

      const runCost = tracker.getRunCost(runId)
      expect(runCost).toBeDefined()
      expect(runCost?.totalCost).toBe(0.015)
      expect(runCost?.backendCosts['kimi-code']).toBe(0.015)
      expect(runCost?.invocations).toHaveLength(1)
    })

    it('should accumulate costs for multiple invocations', () => {
      const tracker = new CostTracker()
      const runId = 'test-run-1'

      tracker.recordInvocation(runId, 'kimi-code', 1000, 0.01)
      tracker.recordInvocation(runId, 'kimi-code', 2000, 0.01)
      tracker.recordInvocation(runId, 'claude-code', 3000, 0.02)

      const runCost = tracker.getRunCost(runId)
      expect(runCost).toBeDefined()
      expect(runCost?.invocations).toHaveLength(3)

      expect(runCost?.totalCost).toBeCloseTo(0.09)
      expect(runCost?.backendCosts['kimi-code']).toBeCloseTo(0.03)
      expect(runCost?.backendCosts['claude-code']).toBeCloseTo(0.06)
    })

    it('should track multiple runs independently', () => {
      const tracker = new CostTracker()

      tracker.recordInvocation('run-1', 'kimi', 1000, 0.01)
      tracker.recordInvocation('run-1', 'kimi', 2000, 0.01)
      tracker.recordInvocation('run-2', 'claude', 1500, 0.02)

      const run1Cost = tracker.getRunCost('run-1')
      const run2Cost = tracker.getRunCost('run-2')

      expect(run1Cost?.totalCost).toBeCloseTo(0.03) // (3000/1000)*0.01
      expect(run2Cost?.totalCost).toBeCloseTo(0.03) // (1500/1000)*0.02
    })
  })

  describe('getHistoricalCosts', () => {
    it('should return recent historical costs', () => {
      const tracker = new CostTracker()

      tracker.recordInvocation('run-1', 'kimi', 1000, 0.01)
      tracker.recordInvocation('run-1', 'claude', 2000, 0.02)
      tracker.recordInvocation('run-2', 'kimi', 1500, 0.01)

      const historical = tracker.getHistoricalCosts(10)

      expect(historical).toHaveLength(3)
      expect(historical[0]?.backendName).toBe('kimi')
      expect(historical[1]?.backendName).toBe('claude')
      expect(historical[2]?.backendName).toBe('kimi')
    })

    it('should respect limit parameter', () => {
      const tracker = new CostTracker()

      for (let i = 0; i < 10; i++) {
        tracker.recordInvocation('run-1', 'kimi', 1000, 0.01)
      }

      const historical = tracker.getHistoricalCosts(5)

      expect(historical).toHaveLength(5)
    })

    it('should return all if limit exceeds available', () => {
      const tracker = new CostTracker()

      tracker.recordInvocation('run-1', 'kimi', 1000, 0.01)
      tracker.recordInvocation('run-1', 'claude', 2000, 0.02)

      const historical = tracker.getHistoricalCosts(100)

      expect(historical).toHaveLength(2)
    })
  })

  describe('checkBudget', () => {
    it('should return false when cost under budget', () => {
      const tracker = new CostTracker()
      const runId = 'test-run'

      tracker.recordInvocation(runId, 'kimi', 1000, 0.01)

      expect(tracker.checkBudget(runId, 0.1)).toBe(false) // 0.01 < 0.1
      expect(tracker.checkBudget(runId, 0.02)).toBe(false) // 0.01 < 0.02
    })

    it('should return true when cost exceeds budget', () => {
      const tracker = new CostTracker()
      const runId = 'test-run'

      tracker.recordInvocation(runId, 'kimi', 10000, 0.01) // Cost = 0.1

      expect(tracker.checkBudget(runId, 0.05)).toBe(true) // 0.1 > 0.05
      expect(tracker.checkBudget(runId, 0.09)).toBe(true) // 0.1 > 0.09
    })

    it('should return false for unknown run', () => {
      const tracker = new CostTracker()

      expect(tracker.checkBudget('unknown-run', 0.1)).toBe(false)
    })

    it('should handle exact budget match', () => {
      const tracker = new CostTracker()
      const runId = 'test-run'

      tracker.recordInvocation(runId, 'kimi', 1000, 0.01) // Cost = 0.01

      expect(tracker.checkBudget(runId, 0.009)).toBe(true) // Barely over
      expect(tracker.checkBudget(runId, 0.01)).toBe(false) // At budget
    })
  })

  describe('cleanupRun', () => {
    it('should remove run cost data', () => {
      const tracker = new CostTracker()
      const runId = 'test-run'

      tracker.recordInvocation(runId, 'kimi', 1000, 0.01)

      expect(tracker.getRunCost(runId)).toBeDefined()
      expect(tracker.cleanupRun(runId)).toBe(true)
      expect(tracker.getRunCost(runId)).toBeUndefined()
      expect(tracker.getTrackedRunCount()).toBe(0)
    })

    it('should return false for unknown run', () => {
      const tracker = new CostTracker()

      expect(tracker.cleanupRun('unknown-run')).toBe(false)
    })
  })

  describe('getTotalHistoricalCost', () => {
    it('should sum all historical costs', () => {
      const tracker = new CostTracker()

      tracker.recordInvocation('run-1', 'kimi', 1000, 0.01) // 0.01
      tracker.recordInvocation('run-1', 'claude', 2000, 0.02) // 0.04
      tracker.recordInvocation('run-2', 'kimi', 1500, 0.01) // 0.015

      expect(tracker.getTotalHistoricalCost()).toBeCloseTo(0.065)
    })

    it('should return 0 for no invocations', () => {
      const tracker = new CostTracker()

      expect(tracker.getTotalHistoricalCost()).toBe(0)
    })
  })

  describe('getTrackedRunCount', () => {
    it('should return count of tracked runs', () => {
      const tracker = new CostTracker()

      expect(tracker.getTrackedRunCount()).toBe(0)

      tracker.recordInvocation('run-1', 'kimi', 1000, 0.01)
      expect(tracker.getTrackedRunCount()).toBe(1)

      tracker.recordInvocation('run-2', 'claude', 2000, 0.02)
      expect(tracker.getTrackedRunCount()).toBe(2)

      tracker.recordInvocation('run-1', 'kimi', 1500, 0.01)
      expect(tracker.getTrackedRunCount()).toBe(2) // Still 2, run-1 already tracked
    })
  })

  describe('getInvocationCount', () => {
    it('should return invocation count for run', () => {
      const tracker = new CostTracker()
      const runId = 'test-run'

      expect(tracker.getInvocationCount(runId)).toBe(0)

      tracker.recordInvocation(runId, 'kimi', 1000, 0.01)
      expect(tracker.getInvocationCount(runId)).toBe(1)

      tracker.recordInvocation(runId, 'claude', 2000, 0.02)
      expect(tracker.getInvocationCount(runId)).toBe(2)

      tracker.recordInvocation(runId, 'kimi', 1500, 0.01)
      expect(tracker.getInvocationCount(runId)).toBe(3)
    })
  })

  describe('invocation details', () => {
    it('should store invocation metadata correctly', () => {
      const tracker = new CostTracker()
      const runId = 'test-run'

      tracker.recordInvocation(runId, 'kimi', 2500, 0.01)

      const runCost = tracker.getRunCost(runId)
      expect(runCost?.invocations).toHaveLength(1)

      const invocation = runCost?.invocations[0]
      expect(invocation?.backendName).toBe('kimi')
      expect(invocation?.tokensUsed).toBe(2500)
      expect(invocation?.costPer1000Tokens).toBe(0.01)
      expect(invocation?.calculatedCost).toBeCloseTo(0.025)
      expect(invocation?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}/) // ISO format check
    })

    it('should handle different cost rates correctly', () => {
      const tracker = new CostTracker()
      const runId = 'test-run'

      // cheap backend
      tracker.recordInvocation(runId, 'gpt4', 1000, 0.03) // $0.03 per 1000

      // expensive backend
      tracker.recordInvocation(runId, 'claude-opus', 1000, 0.15) // $0.15 per 1000

      const runCost = tracker.getRunCost(runId)
      expect(runCost?.backendCosts['gpt4']).toBeCloseTo(0.03)
      expect(runCost?.backendCosts['claude-opus']).toBeCloseTo(0.15)
    })
  })

  describe('budget edge cases', () => {
    it('should handle very small budgets', () => {
      const tracker = new CostTracker()
      const runId = 'test-run'

      tracker.recordInvocation(runId, 'kimi', 1, 0.01) // Cost = 0.00001

      expect(tracker.checkBudget(runId, 0.000001)).toBe(true)
      expect(tracker.checkBudget(runId, 0.00001)).toBe(false)
    })

    it('should handle very large numbers', () => {
      const tracker = new CostTracker()
      const runId = 'test-run'

      tracker.recordInvocation(runId, 'kimi', 1000000, 0.01) // Cost = 10

      expect(tracker.checkBudget(runId, 5)).toBe(true)
      expect(tracker.checkBudget(runId, 15)).toBe(false)
    })

    it('should handle zero cost invocations', () => {
      const tracker = new CostTracker()
      const runId = 'test-run'

      tracker.recordInvocation(runId, 'local-model', 1000, 0) // Free

      expect(tracker.checkBudget(runId, 0)).toBe(false)
      expect(tracker.checkBudget(runId, 0.001)).toBe(false)
    })
  })
})
