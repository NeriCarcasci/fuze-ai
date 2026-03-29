import type { AuditStore } from '../audit-store.js';
/**
 * Prevents duplicate tool executions within the same run.
 *
 * Key design: the key is scoped to the run (runId + toolName + argsHash),
 * so the same tool+args in different runs are NOT considered duplicates.
 */
export declare class IdempotencyManager {
    private readonly auditStore;
    constructor(auditStore: AuditStore);
    /**
     * Generate a per-run idempotency key hash.
     * Same toolName+argsHash in different runs produces a different key.
     */
    generateKey(runId: string, toolName: string, argsHash: string): string;
    /** Returns true if this exact tool+args combination has already run in this run. */
    isDuplicate(key: string): Promise<boolean>;
    /** Record a completed execution so future identical calls return the cache. */
    recordExecution(key: string, runId: string, stepId: string, toolName: string, argsHash: string, result: unknown): Promise<void>;
    /** Returns the cached result for a duplicate call, or null if not found. */
    getCachedResult(key: string): Promise<unknown | null>;
}
//# sourceMappingURL=idempotency.d.ts.map