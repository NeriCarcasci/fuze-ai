import type { UsageStatus } from './types.js'

/**
 * Tracks cumulative token usage and step counts per run.
 * Pure telemetry — no enforcement or ceilings.
 */
export class UsageTracker {
  private totalTokensIn = 0
  private totalTokensOut = 0
  private stepCount = 0

  /**
   * Records token usage from a completed step.
   * @param tokensIn - Number of input tokens consumed.
   * @param tokensOut - Number of output tokens produced.
   */
  recordUsage(tokensIn: number, tokensOut: number): void {
    if (Number.isFinite(tokensIn) && tokensIn >= 0) {
      this.totalTokensIn += tokensIn
    }
    if (Number.isFinite(tokensOut) && tokensOut >= 0) {
      this.totalTokensOut += tokensOut
    }
    this.stepCount++
  }

  /**
   * Returns the current usage status.
   */
  getStatus(): UsageStatus {
    return {
      totalTokensIn: this.totalTokensIn,
      totalTokensOut: this.totalTokensOut,
      stepCount: this.stepCount,
    }
  }
}
