import type { AgentReliability, PatternAlert } from './types.js';
/**
 * Detects cross-run patterns: repeated failures, cost spikes, reliability drops.
 * All analysis is in-memory; only aggregates are stored.
 */
export declare class PatternAnalyser {
    private static readonly MAX_AGENTS;
    private static readonly EVICT_RATIO;
    private readonly outcomes;
    /** Minimum number of runs before emitting pattern alerts. */
    private readonly MIN_RUNS_FOR_ANALYSIS;
    /**
     * Record the outcome of a completed run.
     *
     * @param agentId - The agent that ran.
     * @param status - Final status of the run.
     * @param failedAtStep - Step identifier where the failure occurred (optional).
     * @param failedTool - Tool name that failed (optional).
     * @param cost - Total cost of the run (default 0).
     */
    recordRunOutcome(agentId: string, status: string, failedAtStep?: string, failedTool?: string, cost?: number): void;
    /**
     * Analyse all recorded outcomes and return alerts for patterns that cross thresholds.
     *
     * @returns Array of PatternAlert objects.
     */
    analyse(): PatternAlert[];
    /**
     * Returns reliability statistics for a specific agent.
     *
     * @param agentId - Agent identifier.
     */
    getAgentReliability(agentId: string): AgentReliability;
    private evictOldAgentsIfNeeded;
}
//# sourceMappingURL=pattern-analyser.d.ts.map