/**
 * Detects cross-run patterns: repeated failures, cost spikes, reliability drops.
 * All analysis is in-memory; only aggregates are stored.
 */
export class PatternAnalyser {
    static MAX_AGENTS = 10_000;
    static EVICT_RATIO = 0.2;
    outcomes = new Map();
    /** Minimum number of runs before emitting pattern alerts. */
    MIN_RUNS_FOR_ANALYSIS = 5;
    /**
     * Record the outcome of a completed run.
     *
     * @param agentId - The agent that ran.
     * @param status - Final status of the run.
     * @param failedAtStep - Step identifier where the failure occurred (optional).
     * @param failedTool - Tool name that failed (optional).
     * @param cost - Total cost of the run (default 0).
     */
    recordRunOutcome(agentId, status, failedAtStep, failedTool, cost = 0) {
        const existing = this.outcomes.get(agentId) ?? [];
        existing.push({ status, failedAtStep, failedTool, cost });
        // Touch on write so map order approximates LRU semantics.
        if (this.outcomes.has(agentId)) {
            this.outcomes.delete(agentId);
        }
        this.outcomes.set(agentId, existing);
        this.evictOldAgentsIfNeeded();
    }
    /**
     * Analyse all recorded outcomes and return alerts for patterns that cross thresholds.
     *
     * @returns Array of PatternAlert objects.
     */
    analyse() {
        const alerts = [];
        for (const [agentId, runs] of this.outcomes) {
            if (runs.length < this.MIN_RUNS_FOR_ANALYSIS)
                continue;
            const failures = runs.filter((r) => r.status !== 'completed');
            const failureRate = failures.length / runs.length;
            // Repeated failure alert: > 60% failure rate
            if (failureRate > 0.6) {
                // Find the failure hotspot tool
                const toolCounts = new Map();
                for (const f of failures) {
                    if (f.failedTool) {
                        toolCounts.set(f.failedTool, (toolCounts.get(f.failedTool) ?? 0) + 1);
                    }
                }
                const topTool = [...toolCounts.entries()].sort((a, b) => b[1] - a[1])[0];
                alerts.push({
                    type: 'repeated_failure',
                    agentId,
                    details: {
                        failureRate,
                        failureCount: failures.length,
                        totalRuns: runs.length,
                        topFailedTool: topTool?.[0] ?? null,
                        topFailedToolCount: topTool?.[1] ?? 0,
                    },
                    severity: failureRate > 0.8 ? 'critical' : 'warning',
                });
            }
            // Cost spike: latest run costs > 2x the mean of previous runs
            if (runs.length >= 2) {
                const prev = runs.slice(0, -1);
                const avgPrev = prev.reduce((s, r) => s + r.cost, 0) / prev.length;
                const latest = runs[runs.length - 1].cost;
                if (avgPrev > 0 && latest > avgPrev * 2) {
                    alerts.push({
                        type: 'cost_spike',
                        agentId,
                        details: { latestCost: latest, avgPreviousCost: avgPrev, spikeRatio: latest / avgPrev },
                        severity: 'warning',
                    });
                }
            }
        }
        return alerts;
    }
    /**
     * Returns reliability statistics for a specific agent.
     *
     * @param agentId - Agent identifier.
     */
    getAgentReliability(agentId) {
        const runs = this.outcomes.get(agentId) ?? [];
        if (runs.length === 0) {
            return { totalRuns: 0, successRate: 1.0, avgCost: 0, failureHotspot: null };
        }
        const successes = runs.filter((r) => r.status === 'completed').length;
        const avgCost = runs.reduce((s, r) => s + r.cost, 0) / runs.length;
        // Find failure hotspot (tool that failed most)
        const toolCounts = new Map();
        for (const r of runs) {
            if (r.failedTool) {
                const existing = toolCounts.get(r.failedTool);
                toolCounts.set(r.failedTool, {
                    step: r.failedAtStep ?? 'unknown',
                    count: (existing?.count ?? 0) + 1,
                });
            }
        }
        let failureHotspot = null;
        let maxCount = 0;
        for (const [tool, { step, count }] of toolCounts) {
            if (count > maxCount) {
                maxCount = count;
                failureHotspot = { tool, step, count };
            }
        }
        return {
            totalRuns: runs.length,
            successRate: successes / runs.length,
            avgCost,
            failureHotspot,
        };
    }
    evictOldAgentsIfNeeded() {
        if (this.outcomes.size <= PatternAnalyser.MAX_AGENTS)
            return;
        const toEvict = Math.ceil(this.outcomes.size * PatternAnalyser.EVICT_RATIO);
        for (let i = 0; i < toEvict; i++) {
            const oldest = this.outcomes.keys().next();
            if (oldest.done)
                break;
            this.outcomes.delete(oldest.value);
        }
    }
}
//# sourceMappingURL=pattern-analyser.js.map