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
    totalCost: number;
    timestamp: string;
}
interface GuardEventEntry {
    recordType: 'guard_event';
    event: GuardEventRecord;
}
type TraceEntry = RunStartRecord | (StepRecord & {
    recordType: 'step';
}) | GuardEventEntry | RunEndRecord;
/**
 * Writes execution traces as JSONL to a local file.
 * Buffers records and flushes them to disk.
 */
export declare class TraceRecorder {
    private buffer;
    private readonly outputPath;
    /**
     * @param outputPath - Path to the JSONL output file. Default: './fuze-traces.jsonl'.
     */
    constructor(outputPath?: string);
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
     * Records a guard event (loop detected, budget exceeded, etc.).
     * @param event - The guard event record to log.
     */
    recordGuardEvent(event: GuardEventRecord): void;
    /**
     * Records the end of a run.
     * @param runId - The run identifier.
     * @param status - Final status (e.g., 'completed', 'failed', 'killed').
     * @param totalCost - Total USD cost of the run.
     */
    endRun(runId: string, status: string, totalCost: number): void;
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
    getBuffer(): readonly TraceEntry[];
}
export {};
//# sourceMappingURL=trace-recorder.d.ts.map