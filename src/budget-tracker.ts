import type { BudgetStatus } from './types.js'
import { BudgetExceeded } from './errors.js'

/**
 * Tracks cumulative cost per run and enforces per-step and per-run budget ceilings.
 */
export class BudgetTracker {
  private totalCost = 0
  private totalTokensIn = 0
  private totalTokensOut = 0
  private stepCount = 0

  /**
   * @param maxCostPerStep - Maximum USD allowed for a single step. Default: Infinity.
   * @param maxCostPerRun - Maximum USD allowed for the entire run. Default: Infinity.
   */
  constructor(
    private readonly maxCostPerStep: number = Infinity,
    private readonly maxCostPerRun: number = Infinity,
  ) {}

  /**
   * Called before each step. Throws BudgetExceeded if the estimated cost
   * would breach the step ceiling or the run ceiling.
   * @param estimatedCost - Estimated cost in USD for the upcoming step.
   * @param toolName - Name of the tool/function being called.
   */
  checkBudget(estimatedCost: number, toolName = 'unknown'): void {
    if (estimatedCost > this.maxCostPerStep) {
      throw new BudgetExceeded({
        toolName,
        estimatedCost,
        ceiling: this.maxCostPerStep,
        spent: this.totalCost,
        level: 'step',
      })
    }

    if (this.totalCost + estimatedCost > this.maxCostPerRun) {
      throw new BudgetExceeded({
        toolName,
        estimatedCost,
        ceiling: this.maxCostPerRun,
        spent: this.totalCost,
        level: 'run',
      })
    }
  }

  /**
   * Called after each step with the actual cost incurred.
   * @param cost - Actual cost in USD.
   * @param tokensIn - Number of input tokens consumed.
   * @param tokensOut - Number of output tokens produced.
   */
  recordCost(cost: number, tokensIn: number, tokensOut: number): void {
    this.totalCost += cost
    this.totalTokensIn += tokensIn
    this.totalTokensOut += tokensOut
    this.stepCount++
  }

  /**
   * Returns the current budget status.
   * @returns An object with total cost, token counts, and step count.
   */
  getStatus(): BudgetStatus {
    return {
      totalCost: this.totalCost,
      totalTokensIn: this.totalTokensIn,
      totalTokensOut: this.totalTokensOut,
      stepCount: this.stepCount,
    }
  }
}
