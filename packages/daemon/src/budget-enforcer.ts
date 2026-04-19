import type { BudgetConfig, BudgetDecision } from './types.js'

interface AgentTokens {
  today: number
  lastReset: string  // ISO date string YYYY-MM-DD
}

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Enforces org-wide and per-agent daily token ceilings.
 * Checked before each step via checkBudget().
 */
export class BudgetEnforcer {
  private orgTokens = 0
  private orgLastReset = todayStr()
  private readonly agentTokens = new Map<string, AgentTokens>()

  constructor(private readonly config: BudgetConfig) {}

  /**
   * Ensure daily token counters are for the current day, resetting if needed.
   */
  private rolloverIfNeeded(): void {
    const today = todayStr()
    if (this.orgLastReset !== today) {
      this.resetDaily()
    } else {
      for (const [agentId, spend] of this.agentTokens) {
        if (spend.lastReset !== today) {
          this.agentTokens.set(agentId, { today: 0, lastReset: today })
        }
      }
    }
  }

  private getOrCreateAgent(agentId: string): AgentTokens {
    const today = todayStr()
    if (!this.agentTokens.has(agentId)) {
      this.agentTokens.set(agentId, { today: 0, lastReset: today })
    }
    return this.agentTokens.get(agentId)!
  }

  /**
   * Check whether a step should proceed given estimated token usage.
   *
   * @param agentId - The agent making the call.
   * @param estimatedTokens - Estimated tokens for the upcoming step.
   * @returns null if the step can proceed, or a BudgetDecision with action='kill'.
   */
  checkBudget(agentId: string, estimatedTokens: number): BudgetDecision | null {
    this.rolloverIfNeeded()
    const agent = this.getOrCreateAgent(agentId)

    if (this.orgTokens + estimatedTokens > this.config.orgDailyTokenBudget) {
      return {
        action: 'kill',
        reason: `Org daily token budget of ${this.config.orgDailyTokenBudget} exceeded ` +
                `(current: ${this.orgTokens} + estimated ${estimatedTokens})`,
      }
    }

    if (agent.today + estimatedTokens > this.config.perAgentDailyTokenBudget) {
      return {
        action: 'kill',
        reason: `Agent '${agentId}' daily token budget of ${this.config.perAgentDailyTokenBudget} exceeded ` +
                `(current: ${agent.today} + estimated ${estimatedTokens})`,
      }
    }

    return null
  }

  /**
   * Record actual token usage after a step completes.
   *
   * @param agentId - The agent that consumed tokens.
   * @param tokens - Tokens consumed (tokensIn + tokensOut).
   */
  recordSpend(agentId: string, tokens: number): void {
    this.rolloverIfNeeded()
    this.orgTokens += tokens
    const agent = this.getOrCreateAgent(agentId)
    agent.today += tokens
  }

  getOrgSpend(): { today: number; ceiling: number; remaining: number } {
    this.rolloverIfNeeded()
    return {
      today: this.orgTokens,
      ceiling: this.config.orgDailyTokenBudget,
      remaining: Math.max(0, this.config.orgDailyTokenBudget - this.orgTokens),
    }
  }

  getAgentSpend(agentId: string): { today: number; ceiling: number; remaining: number } {
    this.rolloverIfNeeded()
    const agent = this.getOrCreateAgent(agentId)
    return {
      today: agent.today,
      ceiling: this.config.perAgentDailyTokenBudget,
      remaining: Math.max(0, this.config.perAgentDailyTokenBudget - agent.today),
    }
  }

  getAllAgentSpend(): Record<string, { today: number; ceiling: number; remaining: number }> {
    this.rolloverIfNeeded()
    const result: Record<string, { today: number; ceiling: number; remaining: number }> = {}
    for (const [agentId] of this.agentTokens) {
      result[agentId] = this.getAgentSpend(agentId)
    }
    return result
  }

  isAtAlertThreshold(): boolean {
    return this.orgTokens >= this.config.orgDailyTokenBudget * this.config.alertThreshold
  }

  resetDaily(): void {
    const today = todayStr()
    this.orgTokens = 0
    this.orgLastReset = today
    for (const [agentId] of this.agentTokens) {
      this.agentTokens.set(agentId, { today: 0, lastReset: today })
    }
  }
}
