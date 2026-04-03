import type { RunConfig, RunState, StepData, GuardEventData } from './types.js';
/**
 * Tracks all active agent runs with isolated per-run state.
 * Pure in-memory — no persistence (AuditStore handles SQLite).
 */
export declare class RunManager {
    private static readonly MAX_ENDED;
    private readonly runs;
    private readonly endedRuns;
    private trimEndedRuns;
    /**
     * Register a new run.
     *
     * @param runId - Unique run identifier.
     * @param agentId - Agent identifier.
     * @param config - Run configuration.
     * @param opts - Additional metadata (version, model, etc.).
     */
    startRun(runId: string, agentId: string, config: RunConfig, opts?: {
        agentVersion?: string;
        modelProvider?: string;
        modelName?: string;
    }): void;
    /**
     * Record a completed step against a run.
     *
     * @param runId - Run identifier.
     * @param step - Step data to record.
     * @throws Error if the run does not exist.
     */
    recordStep(runId: string, step: StepData & {
        costUsd?: number;
    }): void;
    /**
     * Record a guard event against a run.
     *
     * @param runId - Run identifier.
     * @param event - Guard event data.
     */
    recordGuardEvent(runId: string, event: GuardEventData): void;
    /**
     * Finalise a run and move it to the ended set.
     *
     * @param runId - Run identifier.
     * @param status - Final status.
     * @param totalCost - Total USD cost reported by the SDK.
     */
    endRun(runId: string, status: string, totalCost: number): void;
    /**
     * Kill an active run (sets status to 'killed').
     *
     * @param runId - Run identifier.
     * @param reason - Human-readable reason for the kill.
     */
    killRun(runId: string, reason: string): void;
    /**
     * Returns all currently active (running) runs.
     */
    getActiveRuns(): RunState[];
    /**
     * Look up a run by ID (active or ended).
     *
     * @param runId - Run identifier.
     * @returns The run state, or null if not found.
     */
    getRun(runId: string): RunState | null;
    /**
     * Returns all runs (active and ended) for a specific agent.
     *
     * @param agentId - Agent identifier.
     */
    getRunsByAgent(agentId: string): RunState[];
    /**
     * Returns the count of currently active runs.
     */
    getActiveRunCount(): number;
}
//# sourceMappingURL=run-manager.d.ts.map