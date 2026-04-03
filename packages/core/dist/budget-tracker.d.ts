import type { UsageStatus } from './types.js';
/**
 * Tracks cumulative token usage and step counts per run.
 * Pure telemetry — no enforcement or ceilings.
 */
export declare class UsageTracker {
    private totalTokensIn;
    private totalTokensOut;
    private stepCount;
    /**
     * Records token usage from a completed step.
     * @param tokensIn - Number of input tokens consumed.
     * @param tokensOut - Number of output tokens produced.
     */
    recordUsage(tokensIn: number, tokensOut: number): void;
    /**
     * Returns the current usage status.
     */
    getStatus(): UsageStatus;
}
//# sourceMappingURL=budget-tracker.d.ts.map