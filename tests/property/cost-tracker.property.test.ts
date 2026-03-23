import { test, fc } from '@fast-check/vitest'
import { describe, expect } from 'vitest'
import { CostTracker } from '@/infrastructure/cost-tracker'

describe('Property 47: Cost calculation correctness', () => {
  /**
   * Property 47: Cost calculation correctness
   * For any combination of tokensUsed and costPer1000Tokens,
   * the calculated cost SHALL equal (tokensUsed / 1000) * costPer1000Tokens
   * within floating-point precision tolerance.
   *
   * Validates: Requirements 26.1, 26.2
   */
  test.prop([
    fc.integer({ min: 0, max: 1000000 }), // tokensUsed
    fc.double({ min: 0.001, max: 0.5, noDefaultInfinity: true, noNaN: true }), // costPer1000Tokens
  ])(
    'should calculate cost with correct formula',
    (tokensUsed, costPer1000Tokens) => {
      const tracker = new CostTracker()
      const runId = 'test-run'

      const calculatedCost = tracker.recordInvocation(
        runId,
        'test-backend',
        tokensUsed,
        costPer1000Tokens,
      )
      const expectedCost = (tokensUsed / 1000) * costPer1000Tokens

      expect(calculatedCost).toBeCloseTo(expectedCost, 10)

      const runCost = tracker.getRunCost(runId)
      expect(runCost?.totalCost).toBeCloseTo(expectedCost, 10)
      expect(runCost?.backendCosts['test-backend']).toBeCloseTo(
        expectedCost,
        10,
      )
    },
  )

  /**
   * Additional property: Cost accumulation
   * For any sequence of invocations, the total cost SHALL equal
   * the sum of all individual invocation costs.
   */
  test.prop([
    fc.array(
      fc.record({
        backend: fc.string({ minLength: 5, maxLength: 20 }),
        tokens: fc.integer({ min: 1, max: 10000 }),
        rate: fc.double({
          min: 0.01,
          max: 0.1,
          noDefaultInfinity: true,
          noNaN: true,
        }),
      }),
      { minLength: 1, maxLength: 20 },
    ),
  ])(
    'should accumulate costs correctly across multiple invocations',
    (invocations) => {
      const tracker = new CostTracker()
      const runId = 'test-run'

      let expectedTotal = 0
      const expectedByBackend = new Map<string, number>()

      for (const inv of invocations) {
        const cost = tracker.recordInvocation(
          runId,
          inv.backend,
          inv.tokens,
          inv.rate,
        )
        expectedTotal += cost

        const current = expectedByBackend.get(inv.backend) || 0
        expectedByBackend.set(inv.backend, current + cost)
      }

      const runCost = tracker.getRunCost(runId)
      expect(runCost).toBeDefined()
      expect(runCost?.totalCost).toBeCloseTo(expectedTotal, 5)

      // Check backend breakdowns
      for (const [backend, expectedCost] of expectedByBackend) {
        expect(runCost!.backendCosts[backend]).toBeCloseTo(expectedCost, 5)
      }

      // Verify invocation count
      expect(runCost?.invocations.length).toBe(invocations.length)
    },
  )

  /**
   * Additional property: Budget checking correctness
   * For any run cost and budget, checkBudget SHALL return true
   * if and only if total cost > budget.
   */
  test.prop([
    fc.array(
      fc.record({
        backend: fc.string({ minLength: 5, maxLength: 20 }),
        tokens: fc.integer({ min: 0, max: 1000 }),
        rate: fc.double({ min: 0.01, max: 0.1, noDefaultInfinity: true }),
      }),
      { minLength: 0, maxLength: 10 },
    ),
    fc.double({ min: 0, max: 1, noDefaultInfinity: true }),
  ])('should correctly identify budget violations', (invocations, budget) => {
    const tracker = new CostTracker()
    const runId = 'test-run'

    let expectedTotal = 0
    for (const inv of invocations) {
      expectedTotal += tracker.recordInvocation(
        runId,
        inv.backend,
        inv.tokens,
        inv.rate,
      )
    }

    const exceeded = tracker.checkBudget(runId, budget)
    expect(exceeded).toBe(expectedTotal > budget)
  })

  /**
   * Additional property: Historical cost tracking
   * For any sequence of invocations across runs,
   * getHistoricalCosts SHALL return the N most recent invocations.
   */
  test.prop([
    fc.array(
      fc.record({
        runId: fc.string({ minLength: 5, maxLength: 10 }),
        backend: fc.string({ minLength: 5, maxLength: 15 }),
        tokens: fc.integer({ min: 1, max: 5000 }),
        rate: fc.double({
          min: 0.01,
          max: 0.1,
          noDefaultInfinity: true,
          noNaN: true,
        }),
      }),
      { minLength: 1, maxLength: 30 },
    ),
    fc.integer({ min: 1, max: 20 }), // limit
  ])(
    'should return correct number of historical costs',
    (invocations, limit) => {
      const tracker = new CostTracker()

      for (const inv of invocations) {
        tracker.recordInvocation(inv.runId, inv.backend, inv.tokens, inv.rate)
      }

      const historical = tracker.getHistoricalCosts(limit)
      const expectedCount = Math.min(limit, invocations.length)

      expect(historical.length).toBe(expectedCount)
      expect(historical.length).toBeLessThanOrEqual(limit)
    },
  )
})
