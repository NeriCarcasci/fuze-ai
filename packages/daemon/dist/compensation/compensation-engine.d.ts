import type { AuditStore } from '../audit-store.js';
import type { AlertManager } from '../alert-manager.js';
import type { CompensationRecord, RollbackResult } from './types.js';
/** A locally-registered compensation handler (closure). */
type CompensationHandler = () => Promise<void>;
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
export declare class CompensationEngine {
    private readonly auditStore;
    private readonly alertManager;
    /** runId → ordered list of registered compensations */
    private readonly registered;
    constructor(auditStore: AuditStore, alertManager: AlertManager);
    /**
     * Register a compensation handler for a specific step.
     * Must be called before rollback for the handler to be invoked.
     */
    registerCompensation(runId: string, stepId: string, toolName: string, handler: CompensationHandler, originalResultJson?: string): void;
    /**
     * Roll back all side-effect steps for a run, starting from fromStepId
     * backwards in registration order.
     */
    rollback(runId: string, fromStepId: string): Promise<RollbackResult>;
    /** Retrieve all compensation records for a run from the DB. */
    getCompensationStatus(runId: string): Promise<CompensationRecord[]>;
    private _storeRecord;
}
export {};
//# sourceMappingURL=compensation-engine.d.ts.map