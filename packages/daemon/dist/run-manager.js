/**
 * Tracks all active agent runs with isolated per-run state.
 * Pure in-memory — no persistence (AuditStore handles SQLite).
 */
export class RunManager {
    static MAX_ENDED = 1000;
    runs = new Map();
    endedRuns = new Map();
    trimEndedRuns() {
        if (this.endedRuns.size <= RunManager.MAX_ENDED)
            return;
        const oldest = this.endedRuns.keys().next();
        if (!oldest.done) {
            this.endedRuns.delete(oldest.value);
        }
    }
    /**
     * Register a new run.
     *
     * @param runId - Unique run identifier.
     * @param agentId - Agent identifier.
     * @param config - Run configuration.
     * @param opts - Additional metadata (version, model, etc.).
     */
    startRun(runId, agentId, config, opts = {}) {
        this.runs.set(runId, {
            runId,
            agentId,
            agentVersion: opts.agentVersion ?? '0.0.0',
            modelProvider: opts.modelProvider ?? 'unknown',
            modelName: opts.modelName ?? 'unknown',
            status: 'running',
            startedAt: new Date().toISOString(),
            totalCost: 0,
            totalSteps: 0,
            steps: [],
            guardEvents: [],
            config,
        });
    }
    /**
     * Record a completed step against a run.
     *
     * @param runId - Run identifier.
     * @param step - Step data to record.
     * @throws Error if the run does not exist.
     */
    recordStep(runId, step) {
        const run = this.runs.get(runId);
        if (!run)
            throw new Error(`RunManager: unknown run '${runId}'`);
        run.steps.push(step);
        run.totalSteps++;
        run.totalCost += step.costUsd ?? 0;
    }
    /**
     * Record a guard event against a run.
     *
     * @param runId - Run identifier.
     * @param event - Guard event data.
     */
    recordGuardEvent(runId, event) {
        const run = this.runs.get(runId);
        if (!run)
            return; // Tolerate events for unknown runs
        run.guardEvents.push(event);
    }
    /**
     * Finalise a run and move it to the ended set.
     *
     * @param runId - Run identifier.
     * @param status - Final status.
     * @param totalCost - Total USD cost reported by the SDK.
     */
    endRun(runId, status, totalCost) {
        const run = this.runs.get(runId);
        if (!run)
            return;
        run.status = status;
        run.totalCost = totalCost;
        this.runs.delete(runId);
        this.endedRuns.set(runId, run);
        this.trimEndedRuns();
    }
    /**
     * Kill an active run (sets status to 'killed').
     *
     * @param runId - Run identifier.
     * @param reason - Human-readable reason for the kill.
     */
    killRun(runId, reason) {
        const run = this.runs.get(runId);
        if (!run)
            return;
        run.status = 'killed';
        run.killReason = reason;
        this.runs.delete(runId);
        this.endedRuns.set(runId, run);
        this.trimEndedRuns();
    }
    /**
     * Returns all currently active (running) runs.
     */
    getActiveRuns() {
        return Array.from(this.runs.values());
    }
    /**
     * Look up a run by ID (active or ended).
     *
     * @param runId - Run identifier.
     * @returns The run state, or null if not found.
     */
    getRun(runId) {
        return this.runs.get(runId) ?? this.endedRuns.get(runId) ?? null;
    }
    /**
     * Returns all runs (active and ended) for a specific agent.
     *
     * @param agentId - Agent identifier.
     */
    getRunsByAgent(agentId) {
        return [
            ...Array.from(this.runs.values()),
            ...Array.from(this.endedRuns.values()),
        ].filter((r) => r.agentId === agentId);
    }
    /**
     * Returns the count of currently active runs.
     */
    getActiveRunCount() {
        return this.runs.size;
    }
}
//# sourceMappingURL=run-manager.js.map