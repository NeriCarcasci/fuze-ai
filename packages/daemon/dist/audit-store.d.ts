import type { RunRecord, DbStepRecord, DbGuardEventRecord } from './types.js';
import type { CompensationRecord, IdempotencyRecord } from './compensation/types.js';
interface ListRunsOpts {
    agentId?: string;
    status?: string;
    since?: string;
    limit?: number;
    offset?: number;
}
export declare class AuditStore {
    private readonly dbPath;
    private db;
    private lastRunHash;
    private lastStepHash;
    private lastEventHash;
    private lastCompHash;
    constructor(dbPath: string);
    /**
     * Create tables (if not exist) and load last chain hashes.
     */
    init(): Promise<void>;
    insertRun(run: Omit<RunRecord, 'prevHash' | 'hash'>): Promise<void>;
    insertStep(step: Omit<DbStepRecord, 'prevHash' | 'hash'>): Promise<void>;
    insertGuardEvent(event: Omit<DbGuardEventRecord, 'prevHash' | 'hash'>): Promise<void>;
    updateRunStatus(runId: string, status: string, totalCost: number, endedAt?: string): Promise<void>;
    getRun(runId: string): Promise<RunRecord | null>;
    getRunSteps(runId: string): Promise<DbStepRecord[]>;
    getRunGuardEvents(runId: string): Promise<DbGuardEventRecord[]>;
    listRuns(opts?: ListRunsOpts): Promise<RunRecord[]>;
    countRuns(opts?: Omit<ListRunsOpts, 'limit' | 'offset'>): Promise<number>;
    /**
     * Verify the integrity of all three hash chains.
     *
     * @returns { valid: true } or { valid: false, brokenAt: id }
     */
    verifyHashChain(): Promise<{
        valid: boolean;
        brokenAt?: string;
    }>;
    getRetentionStatus(): Promise<{
        totalRuns: number;
        oldestRun: string;
        dbSizeBytes: number;
    }>;
    /**
     * Purge runs (and associated steps/events) older than the specified number of days.
     *
     * @param days - Runs older than this many days will be deleted.
     * @returns Number of runs deleted.
     */
    purgeOlderThan(days: number): Promise<number>;
    insertCompensationRecord(record: Omit<CompensationRecord, 'prevHash' | 'hash'>): Promise<void>;
    getCompensationByRun(runId: string): Promise<CompensationRecord[]>;
    insertIdempotencyKey(record: IdempotencyRecord): Promise<void>;
    getIdempotencyKey(keyHash: string): Promise<IdempotencyRecord | null>;
    close(): Promise<void>;
    private _rowToRun;
    private _rowToStep;
    private _rowToEvent;
    private _rowToCompensation;
    private _rowToIdempotency;
}
export {};
//# sourceMappingURL=audit-store.d.ts.map