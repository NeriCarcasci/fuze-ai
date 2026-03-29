import type { BudgetStatus } from './types.js';
/**
 * Tracks cumulative cost per run and enforces per-step and per-run budget ceilings.
 */
export declare class BudgetTracker {
    private readonly maxCostPerStep;
    private readonly maxCostPerRun;
    private totalCost;
    private totalTokensIn;
    private totalTokensOut;
    private stepCount;
    /**
     * @param maxCostPerStep - Maximum USD allowed for a single step. Default: Infinity.
     * @param maxCostPerRun - Maximum USD allowed for the entire run. Default: Infinity.
     */
    constructor(maxCostPerStep?: number, maxCostPerRun?: number);
    /**
     * Called before each step. Throws BudgetExceeded if the estimated cost
     * would breach the step ceiling or the run ceiling.
     * @param estimatedCost - Estimated cost in USD for the upcoming step.
     * @param toolName - Name of the tool/function being called.
     */
    checkBudget(estimatedCost: number, toolName?: string): void;
    /**
     * Called after each step with the actual cost incurred.
     * @param cost - Actual cost in USD.
     * @param tokensIn - Number of input tokens consumed.
     * @param tokensOut - Number of output tokens produced.
     */
    recordCost(cost: number, tokensIn: number, tokensOut: number): void;
    /**
     * Returns the current budget status.
     * @returns An object with total cost, token counts, and step count.
     */
    getStatus(): BudgetStatus;
}
//# sourceMappingURL=budget-tracker.d.ts.map