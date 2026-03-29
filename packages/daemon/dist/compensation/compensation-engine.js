import { randomUUID } from 'node:crypto';
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
    auditStore;
    alertManager;
    /** runId → ordered list of registered compensations */
    registered = new Map();
    constructor(auditStore, alertManager) {
        this.auditStore = auditStore;
        this.alertManager = alertManager;
    }
    /**
     * Register a compensation handler for a specific step.
     * Must be called before rollback for the handler to be invoked.
     */
    registerCompensation(runId, stepId, toolName, handler, originalResultJson = '{}') {
        if (!this.registered.has(runId))
            this.registered.set(runId, []);
        this.registered.get(runId).push({ stepId, toolName, originalResultJson, handler });
    }
    /**
     * Roll back all side-effect steps for a run, starting from fromStepId
     * backwards in registration order.
     */
    async rollback(runId, fromStepId) {
        const existing = await this.auditStore.getCompensationByRun(runId);
        const alreadyDone = existing.filter((r) => r.compensationStatus === 'succeeded');
        const steps = await this.auditStore.getRunSteps(runId);
        // Determine which steps are side-effect steps up to and including fromStepId
        const fromIdx = steps.findIndex((s) => s.stepId === fromStepId);
        const targetSteps = fromIdx === -1 ? steps : steps.slice(0, fromIdx + 1);
        const sideEffectSteps = targetSteps.filter((s) => s.hasSideEffect === 1);
        const handlers = this.registered.get(runId) ?? [];
        const handlerMap = new Map(handlers.map((h) => [h.stepId, h]));
        const records = [];
        let compensated = 0;
        let failed = 0;
        let noCompensation = 0;
        let skipped = 0;
        // Process in reverse order (LIFO)
        const reversed = [...sideEffectSteps].reverse();
        for (const step of reversed) {
            const alreadyCompensated = alreadyDone.find((r) => r.stepId === step.stepId);
            if (alreadyCompensated) {
                // Idempotent — skip already-compensated steps
                records.push(alreadyCompensated);
                skipped++;
                continue;
            }
            const compensationId = randomUUID();
            const startedAt = new Date().toISOString();
            const entry = handlerMap.get(step.stepId);
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
                });
                records.push(record);
                noCompensation++;
                this.alertManager.emit({
                    type: 'compensation_escalated',
                    severity: 'critical',
                    message: `No compensation registered for side-effect step '${step.toolName}' (${step.stepId})`,
                    details: { runId, stepId: step.stepId, toolName: step.toolName },
                });
                continue;
            }
            // Execute handler
            let status = 'succeeded';
            let compensationError = null;
            try {
                await entry.handler();
            }
            catch (err) {
                status = 'failed';
                compensationError = err instanceof Error ? err.message : String(err);
                failed++;
                this.alertManager.emit({
                    type: 'compensation_failed',
                    severity: 'critical',
                    message: `Compensation failed for tool '${step.toolName}': ${compensationError}`,
                    details: { runId, stepId: step.stepId, toolName: step.toolName, error: compensationError },
                });
            }
            const endedAt = new Date().toISOString();
            if (status === 'succeeded')
                compensated++;
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
            });
            records.push(record);
        }
        // Non-side-effect steps → skipped
        const nonSideEffectCount = targetSteps.filter((s) => s.hasSideEffect !== 1).length;
        skipped += nonSideEffectCount;
        return {
            totalSteps: targetSteps.length,
            compensated,
            failed,
            noCompensation,
            skipped,
            details: records,
        };
    }
    /** Retrieve all compensation records for a run from the DB. */
    async getCompensationStatus(runId) {
        return this.auditStore.getCompensationByRun(runId);
    }
    // ── Private ─────────────────────────────────────────────────────────────────
    async _storeRecord(data) {
        await this.auditStore.insertCompensationRecord(data);
        return { ...data, prevHash: '', hash: '' };
    }
}
//# sourceMappingURL=compensation-engine.js.map