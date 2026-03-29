import type { BudgetConfig, BudgetDecision } from './types.js';
/**
 * Enforces org-wide and per-agent daily budget ceilings.
 * Checked before each step via checkBudget().
 */
export declare class BudgetEnforcer {
    private readonly config;
    private orgSpend;
    private orgLastReset;
    private readonly agentSpend;
    constructor(config: BudgetConfig);
    /**
     * Ensure daily spend counters are for the current day, resetting if needed.
     */
    private rolloverIfNeeded;
    private getOrCreateAgent;
    /**
     * Check whether a step should proceed given estimated cost.
     *
     * @param agentId - The agent making the call.
     * @param estimatedCost - Estimated cost in USD for the upcoming step.
     * @returns null if the step can proceed, or a BudgetDecision with action='kill'.
     */
    checkBudget(agentId: string, estimatedCost: number): BudgetDecision | null;
    /**
     * Record actual spend after a step completes.
     *
     * @param agentId - The agent that incurred the cost.
     * @param cost - Actual cost in USD.
     */
    recordSpend(agentId: string, cost: number): void;
    /**
     * Returns org-level spend status.
     */
    getOrgSpend(): {
        today: number;
        ceiling: number;
        remaining: number;
    };
    /**
     * Returns spend status for a specific agent.
     *
     * @param agentId - Agent identifier.
     */
    getAgentSpend(agentId: string): {
        today: number;
        ceiling: number;
        remaining: number;
    };
    /**
     * Returns spend for all known agents.
     */
    getAllAgentSpend(): Record<string, {
        today: number;
        ceiling: number;
        remaining: number;
    }>;
    /**
     * Returns whether the org has crossed the alert threshold.
     */
    isAtAlertThreshold(): boolean;
    /**
     * Reset all daily budget counters to zero.
     */
    resetDaily(): void;
}
//# sourceMappingURL=budget-enforcer.d.ts.map