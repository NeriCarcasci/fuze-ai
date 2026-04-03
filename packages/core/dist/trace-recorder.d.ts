import type { StepRecord, GuardEventRecord } from './types.js';
interface RunStartRecord {
    recordType: 'run_start';
    runId: string;
    agentId: string;
    config: object;
    timestamp: string;
}
interface RunEndRecord {
    recordType: 'run_end';
    runId: string;
    status: string;
    timestamp: string;
}
interface GuardEventEntry {
    recordType: 'guard_event';
    event: GuardEventRecord;
}
interface ChainFields {
    hash: string;
    prevHash: string;
    signature?: string;
    sequence: number;
}
export type TraceEntry = RunStartRecord | (StepRecord & {
    recordType: 'step';
}) | GuardEventEntry | RunEndRecord;
export type SignedTraceEntry = (TraceEntry & ChainFields);
export interface VerifyChainResult {
    valid: boolean;
    hmacValid: boolean;
    firstInvalidIndex?: number;
}
export declare function verifyChain(entries: TraceEntry[]): VerifyChainResult;
/**
 * Writes execution traces as JSONL to a local file.
 * Buffers records and flushes them to disk.
 */
export declare class TraceRecorder {
    private readonly key;
    private buffer;
    private readonly outputPath;
    private sequence;
    private lastHash;
    /**
     * @param outputPath - Path to the JSONL output file. Default: './fuze-traces.jsonl'.
     */
    constructor(outputPath?: string);
    private appendSignedEntry;
    /**
     * Records the start of a run.
     * @param runId - Unique run identifier.
     * @param agentId - Identifier for the agent/caller.
     * @param config - The resolved configuration for this run.
     */
    startRun(runId: string, agentId: string, config: object): void;
    /**
     * Records a step execution.
     * @param step - The step record to log.
     */
    recordStep(step: StepRecord): void;
    /**
     * Records a guard event (loop detected, timeout, etc.).
     * @param event - The guard event record to log.
     */
    recordGuardEvent(event: GuardEventRecord): void;
    /**
     * Records the end of a run.
     * @param runId - The run identifier.
     * @param status - Final status (e.g., 'completed', 'failed', 'killed').
     */
    endRun(runId: string, status: string): void;
    /**
     * Writes all buffered records to disk as JSONL (one JSON object per line).
     * Clears the buffer after writing.
     */
    flush(): Promise<void>;
    /**
     * Returns the number of buffered (unflushed) records.
     */
    get pendingCount(): number;
    /**
     * Returns the buffered entries (for testing).
     */
    getBuffer(): readonly SignedTraceEntry[];
}
export {};
//# sourceMappingURL=trace-recorder.d.ts.map