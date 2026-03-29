import { createHash } from 'node:crypto';
/**
 * Prevents duplicate tool executions within the same run.
 *
 * Key design: the key is scoped to the run (runId + toolName + argsHash),
 * so the same tool+args in different runs are NOT considered duplicates.
 */
export class IdempotencyManager {
    auditStore;
    constructor(auditStore) {
        this.auditStore = auditStore;
    }
    /**
     * Generate a per-run idempotency key hash.
     * Same toolName+argsHash in different runs produces a different key.
     */
    generateKey(runId, toolName, argsHash) {
        return createHash('sha256')
            .update(`${runId}:${toolName}:${argsHash}`)
            .digest('hex');
    }
    /** Returns true if this exact tool+args combination has already run in this run. */
    async isDuplicate(key) {
        const record = await this.auditStore.getIdempotencyKey(key);
        return record !== null;
    }
    /** Record a completed execution so future identical calls return the cache. */
    async recordExecution(key, runId, stepId, toolName, argsHash, result) {
        await this.auditStore.insertIdempotencyKey({
            keyHash: key,
            runId,
            stepId,
            toolName,
            argsHash,
            createdAt: new Date().toISOString(),
            resultJson: result !== undefined ? JSON.stringify(result) : null,
        });
    }
    /** Returns the cached result for a duplicate call, or null if not found. */
    async getCachedResult(key) {
        const record = await this.auditStore.getIdempotencyKey(key);
        if (!record || record.resultJson === null)
            return null;
        try {
            return JSON.parse(record.resultJson);
        }
        catch {
            return null;
        }
    }
}
//# sourceMappingURL=idempotency.js.map