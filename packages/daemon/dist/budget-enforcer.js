function todayStr() {
    return new Date().toISOString().slice(0, 10);
}
/**
 * Enforces org-wide and per-agent daily budget ceilings.
 * Checked before each step via checkBudget().
 */
export class BudgetEnforcer {
    config;
    orgSpend = 0;
    orgLastReset = todayStr();
    agentSpend = new Map();
    constructor(config) {
        this.config = config;
    }
    /**
     * Ensure daily spend counters are for the current day, resetting if needed.
     */
    rolloverIfNeeded() {
        const today = todayStr();
        if (this.orgLastReset !== today) {
            this.resetDaily();
        }
        else {
            // Roll over individual agents that haven't been reset today
            for (const [agentId, spend] of this.agentSpend) {
                if (spend.lastReset !== today) {
                    this.agentSpend.set(agentId, { today: 0, lastReset: today });
                }
            }
        }
    }
    getOrCreateAgent(agentId) {
        const today = todayStr();
        if (!this.agentSpend.has(agentId)) {
            this.agentSpend.set(agentId, { today: 0, lastReset: today });
        }
        return this.agentSpend.get(agentId);
    }
    /**
     * Check whether a step should proceed given estimated cost.
     *
     * @param agentId - The agent making the call.
     * @param estimatedCost - Estimated cost in USD for the upcoming step.
     * @returns null if the step can proceed, or a BudgetDecision with action='kill'.
     */
    checkBudget(agentId, estimatedCost) {
        this.rolloverIfNeeded();
        const agent = this.getOrCreateAgent(agentId);
        // Check org-wide ceiling
        if (this.orgSpend + estimatedCost > this.config.orgDailyBudget) {
            return {
                action: 'kill',
                reason: `Org daily budget of $${this.config.orgDailyBudget.toFixed(2)} exceeded ` +
                    `(current: $${this.orgSpend.toFixed(2)} + estimated $${estimatedCost.toFixed(2)})`,
            };
        }
        // Check per-agent ceiling
        if (agent.today + estimatedCost > this.config.perAgentDailyBudget) {
            return {
                action: 'kill',
                reason: `Agent '${agentId}' daily budget of $${this.config.perAgentDailyBudget.toFixed(2)} exceeded ` +
                    `(current: $${agent.today.toFixed(2)} + estimated $${estimatedCost.toFixed(2)})`,
            };
        }
        // Alert threshold check (return null but callers can read alert state)
        return null;
    }
    /**
     * Record actual spend after a step completes.
     *
     * @param agentId - The agent that incurred the cost.
     * @param cost - Actual cost in USD.
     */
    recordSpend(agentId, cost) {
        this.rolloverIfNeeded();
        this.orgSpend += cost;
        const agent = this.getOrCreateAgent(agentId);
        agent.today += cost;
    }
    /**
     * Returns org-level spend status.
     */
    getOrgSpend() {
        this.rolloverIfNeeded();
        return {
            today: this.orgSpend,
            ceiling: this.config.orgDailyBudget,
            remaining: Math.max(0, this.config.orgDailyBudget - this.orgSpend),
        };
    }
    /**
     * Returns spend status for a specific agent.
     *
     * @param agentId - Agent identifier.
     */
    getAgentSpend(agentId) {
        this.rolloverIfNeeded();
        const agent = this.getOrCreateAgent(agentId);
        return {
            today: agent.today,
            ceiling: this.config.perAgentDailyBudget,
            remaining: Math.max(0, this.config.perAgentDailyBudget - agent.today),
        };
    }
    /**
     * Returns spend for all known agents.
     */
    getAllAgentSpend() {
        this.rolloverIfNeeded();
        const result = {};
        for (const [agentId] of this.agentSpend) {
            result[agentId] = this.getAgentSpend(agentId);
        }
        return result;
    }
    /**
     * Returns whether the org has crossed the alert threshold.
     */
    isAtAlertThreshold() {
        return this.orgSpend >= this.config.orgDailyBudget * this.config.alertThreshold;
    }
    /**
     * Reset all daily budget counters to zero.
     */
    resetDaily() {
        const today = todayStr();
        this.orgSpend = 0;
        this.orgLastReset = today;
        for (const [agentId] of this.agentSpend) {
            this.agentSpend.set(agentId, { today: 0, lastReset: today });
        }
    }
}
//# sourceMappingURL=budget-enforcer.js.map