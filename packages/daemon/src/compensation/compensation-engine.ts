import { randomUUID } from 'node:crypto'
import type { AuditStore } from '../audit-store.js'
import type { AlertManager, AlertInput } from '../alert-manager.js'

// satisfies used to type-check AlertInput literals at callsites
import type {
  CompensationRecord,
  CompensationStatus,
  RollbackResult,
  SerializedCompensation,
} from './types.js'

/** A locally-registered compensation handler (closure). */
type CompensationHandler = () => Promise<void>

interface RegisteredCompensation {
  stepId: string
  toolName: string
  originalResultJson: string
  handler: CompensationHandler
}

/**
 * Orchestrates side-effect rollback for a run.
 *
 * Usage:
 *   engine.registerCompensation(runId, stepId, toolName, handler)
 *   const result = await engine.rollback(runId, fromStepId)
 *
 * Compensations execute in reverse registration order (LIFO).
 * Steps without a registered handler get status "no_compensation" + are escalated.
 * Non-side-effect steps (hasSideEffect=0 in DB) get status "skipped".
 */
export class CompensationEngine {
  /** runId → ordered list of registered compensations */
  private readonly registered = new Map<string, RegisteredCompensation[]>()

  constructor(
    private readonly auditStore: AuditStore,
    private readonly alertManager: AlertManager,
  ) {}

  /**
   * Register a compensation handler for a specific step.
   * Must be called before rollback for the handler to be invoked.
   */
  registerCompensation(
    runId: string,
    stepId: string,
    toolName: string,
    handler: CompensationHandler,
    originalResultJson = '{}',
  ): void {
    if (!this.registered.has(runId)) this.registered.set(runId, [])
    this.registered.get(runId)!.push({ stepId, toolName, originalResultJson, handler })
  }

  /**
   * Roll back all side-effect steps for a run, starting from fromStepId
   * backwards in registration order.
   */
  async rollback(runId: string, fromStepId: string): Promise<RollbackResult> {
    const existing = await this.auditStore.getCompensationByRun(runId)
    const alreadyDone = existing.filter(
      (r) => r.compensationStatus === 'succeeded',
    )

    const steps = await this.auditStore.getRunSteps(runId)
    // Determine which steps are side-effect steps up to and including fromStepId
    const fromIdx = steps.findIndex((s) => s.stepId === fromStepId)
    const targetSteps = fromIdx === -1 ? steps : steps.slice(0, fromIdx + 1)
    const sideEffectSteps = targetSteps.filter((s) => s.hasSideEffect === 1)

    const handlers = this.registered.get(runId) ?? []
    const handlerMap = new Map(handlers.map((h) => [h.stepId, h]))

    const records: CompensationRecord[] = []
    let compensated = 0
    let failed = 0
    let noCompensation = 0
    let skipped = 0

    // Process in reverse order (LIFO)
    const reversed = [...sideEffectSteps].reverse()

    for (const step of reversed) {
      const alreadyCompensated = alreadyDone.find((r) => r.stepId === step.stepId)
      if (alreadyCompensated) {
        // Idempotent — skip already-compensated steps
        records.push(alreadyCompensated)
        skipped++
        continue
      }

      const compensationId = randomUUID()
      const startedAt = new Date().toISOString()

      const entry = handlerMap.get(step.stepId)
      if (!entry) {
        // No compensation registered → "no_compensation", escalate
        const record = await this._storeRecord({
          compensationId,
          runId,
          stepId: step.stepId,
          toolName: step.toolName,
          originalResultJson: null,
          compensationStatus: 'no_compensation',
          compensationStartedAt: startedAt,
          compensationEndedAt: new Date().toISOString(),
          compensationError: null,
          escalated: true,
        })
        records.push(record)
        noCompensation++

        this.alertManager.emit({
          type: 'compensation_escalated',
          severity: 'critical',
          message: `No compensation registered for side-effect step '${step.toolName}' (${step.stepId})`,
          details: { runId, stepId: step.stepId, toolName: step.toolName },
        } satisfies AlertInput)
        continue
      }

      // Execute handler
      let status: CompensationStatus = 'succeeded'
      let compensationError: string | null = null

      try {
        await entry.handler()
      } catch (err) {
        status = 'failed'
        compensationError = err instanceof Error ? err.message : String(err)
        failed++

        this.alertManager.emit({
          type: 'compensation_failed',
          severity: 'critical',
          message: `Compensation failed for tool '${step.toolName}': ${compensationError}`,
          details: { runId, stepId: step.stepId, toolName: step.toolName, error: compensationError },
        } satisfies AlertInput)
      }

      const endedAt = new Date().toISOString()
      if (status === 'succeeded') compensated++

      const record = await this._storeRecord({
        compensationId,
        runId,
        stepId: step.stepId,
        toolName: step.toolName,
        originalResultJson: entry.originalResultJson,
        compensationStatus: status,
        compensationStartedAt: startedAt,
        compensationEndedAt: endedAt,
        compensationError,
        escalated: false,
      })
      records.push(record)
    }

    // Non-side-effect steps → skipped
    const nonSideEffectCount = targetSteps.filter((s) => s.hasSideEffect !== 1).length
    skipped += nonSideEffectCount

    return {
      totalSteps: targetSteps.length,
      compensated,
      failed,
      noCompensation,
      skipped,
      details: records,
    }
  }

  /** Retrieve all compensation records for a run from the DB. */
  async getCompensationStatus(runId: string): Promise<CompensationRecord[]> {
    return this.auditStore.getCompensationByRun(runId)
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private async _storeRecord(
    data: Omit<CompensationRecord, 'prevHash' | 'hash'>,
  ): Promise<CompensationRecord> {
    await this.auditStore.insertCompensationRecord(data)
    return { ...data, prevHash: '', hash: '' } as CompensationRecord
  }
}
