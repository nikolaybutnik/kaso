/**
 * Cost data for a single backend invocation
 */
export interface InvocationCost {
  backendName: string
  tokensUsed: number
  costPer1000Tokens: number
  calculatedCost: number
  timestamp: string
}

/**
 * Per-run cost tracking
 */
export interface RunCost {
  runId: string
  totalCost: number
  backendCosts: Record<string, number> // backend name -> total cost
  invocations: InvocationCost[]
}

/**
 * Cost accumulator for efficient tracking
 */
interface CostAccumulator {
  total: number
  byBackend: Map<string, number>
  invocations: InvocationCost[]
}

/**
 * Cost tracker for managing execution costs across runs
 * Implements requirements 26.1, 26.2, 26.3, 26.4
 */
export class CostTracker {
  private runCosts = new Map<string, CostAccumulator>()
  private historicalCosts: InvocationCost[] = []
  private maxHistorySize: number

  constructor(maxHistorySize: number = 10000) {
    this.maxHistorySize = maxHistorySize
  }

  /**
   * Record a backend invocation cost
   * Cost formula: (tokensUsed / 1000) * costPer1000Tokens
   */
  recordInvocation(
    runId: string,
    backendName: string,
    tokensUsed: number,
    costPer1000Tokens: number,
  ): number {
    const calculatedCost = (tokensUsed / 1000) * costPer1000Tokens
    const timestamp = new Date().toISOString()

    // Initialize run cost accumulator if needed
    if (!this.runCosts.has(runId)) {
      this.runCosts.set(runId, {
        total: 0,
        byBackend: new Map(),
        invocations: [],
      })
    }

    const accumulator = this.runCosts.get(runId)!

    // Record the invocation
    const invocation: InvocationCost = {
      backendName,
      tokensUsed,
      costPer1000Tokens,
      calculatedCost,
      timestamp,
    }

    accumulator.invocations.push(invocation)
    accumulator.total += calculatedCost

    // Update backend-specific total
    const currentBackendTotal = accumulator.byBackend.get(backendName) || 0
    accumulator.byBackend.set(backendName, currentBackendTotal + calculatedCost)

    // Add to historical costs
    this.historicalCosts.push(invocation)
    if (this.historicalCosts.length > this.maxHistorySize) {
      this.historicalCosts.shift() // Remove oldest
    }

    return calculatedCost
  }

  /**
   * Get total cost for a specific run
   */
  getRunCost(runId: string): RunCost | undefined {
    const accumulator = this.runCosts.get(runId)
    if (!accumulator) {
      return undefined
    }

    // Convert backend Map to plain object
    // Null-prototype object prevents prototype pollution with keys like '__proto__'
    const backendCosts: Record<string, number> = Object.create(null) as Record<
      string,
      number
    >
    for (const [backend, cost] of accumulator.byBackend) {
      backendCosts[backend] = cost
    }

    return {
      runId,
      totalCost: accumulator.total,
      backendCosts,
      invocations: accumulator.invocations,
    }
  }

  /**
   * Get historical costs across all runs
   */
  getHistoricalCosts(limit: number = 100): InvocationCost[] {
    const startIndex = Math.max(0, this.historicalCosts.length - limit)
    return this.historicalCosts.slice(startIndex)
  }

  /**
   * Check if a run's cost exceeds a budget
   * @returns true if budget exceeded, false otherwise
   */
  checkBudget(runId: string, budget: number): boolean {
    const accumulator = this.runCosts.get(runId)
    if (!accumulator) {
      return false // No cost recorded yet, budget not exceeded
    }

    return accumulator.total > budget
  }

  /**
   * Get the total cost across all runs
   */
  getTotalHistoricalCost(): number {
    return this.historicalCosts.reduce(
      (total, invocation) => total + invocation.calculatedCost,
      0,
    )
  }

  /**
   * Cleanup run cost data (useful after run completion to free memory)
   */
  cleanupRun(runId: string): boolean {
    return this.runCosts.delete(runId)
  }

  /**
   * Get the number of tracked runs
   */
  getTrackedRunCount(): number {
    return this.runCosts.size
  }

  /**
   * Get invocation count for a run
   */
  getInvocationCount(runId: string): number {
    return this.runCosts.get(runId)?.invocations.length ?? 0
  }
}
