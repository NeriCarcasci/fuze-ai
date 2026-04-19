import type { RunConfig, RunState, StepData, GuardEventData } from './types.js'

/**
 * Tracks all active agent runs with isolated per-run state.
 * Pure in-memory — no persistence (AuditStore handles SQLite).
 */
export class RunManager {
  private static readonly MAX_ENDED = 1000
  private readonly runs = new Map<string, RunState>()
  private readonly endedRuns = new Map<string, RunState>()

  private trimEndedRuns(): void {
    if (this.endedRuns.size <= RunManager.MAX_ENDED) return
    const oldest = this.endedRuns.keys().next()
    if (!oldest.done) {
      this.endedRuns.delete(oldest.value)
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
  startRun(
    runId: string,
    agentId: string,
    config: RunConfig,
    opts: { agentVersion?: string; modelProvider?: string; modelName?: string } = {},
  ): void {
    this.runs.set(runId, {
      runId,
      agentId,
      agentVersion: opts.agentVersion ?? '0.0.0',
      modelProvider: opts.modelProvider ?? 'unknown',
      modelName: opts.modelName ?? 'unknown',
      status: 'running',
      startedAt: new Date().toISOString(),
      totalTokensIn: 0,
      totalTokensOut: 0,
      totalSteps: 0,
      steps: [],
      guardEvents: [],
      config,
    })
  }

  /**
   * Record a completed step against a run.
   *
   * @param runId - Run identifier.
   * @param step - Step data to record.
   * @throws Error if the run does not exist.
   */
  recordStep(runId: string, step: StepData & { tokensIn?: number; tokensOut?: number }): void {
    const run = this.runs.get(runId)
    if (!run) throw new Error(`RunManager: unknown run '${runId}'`)
    run.steps.push(step)
    run.totalSteps++
    run.totalTokensIn += step.tokensIn ?? 0
    run.totalTokensOut += step.tokensOut ?? 0
  }

  /**
   * Record a guard event against a run.
   *
   * @param runId - Run identifier.
   * @param event - Guard event data.
   */
  recordGuardEvent(runId: string, event: GuardEventData): void {
    const run = this.runs.get(runId)
    if (!run) return // Tolerate events for unknown runs
    run.guardEvents.push(event)
  }

  /**
   * Finalise a run and move it to the ended set.
   *
   * @param runId - Run identifier.
   * @param status - Final status.
   */
  endRun(runId: string, status: string): void {
    const run = this.runs.get(runId)
    if (!run) return
    run.status = status as RunState['status']
    this.runs.delete(runId)
    this.endedRuns.set(runId, run)
    this.trimEndedRuns()
  }

  /**
   * Kill an active run (sets status to 'killed').
   *
   * @param runId - Run identifier.
   * @param reason - Human-readable reason for the kill.
   */
  killRun(runId: string, reason: string): void {
    const run = this.runs.get(runId)
    if (!run) return
    run.status = 'killed'
    run.killReason = reason
    this.runs.delete(runId)
    this.endedRuns.set(runId, run)
    this.trimEndedRuns()
  }

  /**
   * Returns all currently active (running) runs.
   */
  getActiveRuns(): RunState[] {
    return Array.from(this.runs.values())
  }

  /**
   * Look up a run by ID (active or ended).
   *
   * @param runId - Run identifier.
   * @returns The run state, or null if not found.
   */
  getRun(runId: string): RunState | null {
    return this.runs.get(runId) ?? this.endedRuns.get(runId) ?? null
  }

  /**
   * Returns all runs (active and ended) for a specific agent.
   *
   * @param agentId - Agent identifier.
   */
  getRunsByAgent(agentId: string): RunState[] {
    return [
      ...Array.from(this.runs.values()),
      ...Array.from(this.endedRuns.values()),
    ].filter((r) => r.agentId === agentId)
  }

  /**
   * Returns the count of currently active runs.
   */
  getActiveRunCount(): number {
    return this.runs.size
  }
}
