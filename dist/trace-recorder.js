import { appendFile, writeFile } from 'node:fs/promises';
/**
 * Writes execution traces as JSONL to a local file.
 * Buffers records and flushes them to disk.
 */
export class TraceRecorder {
    buffer = [];
    outputPath;
    /**
     * @param outputPath - Path to the JSONL output file. Default: './fuze-traces.jsonl'.
     */
    constructor(outputPath = './fuze-traces.jsonl') {
        this.outputPath = outputPath;
    }
    /**
     * Records the start of a run.
     * @param runId - Unique run identifier.
     * @param agentId - Identifier for the agent/caller.
     * @param config - The resolved configuration for this run.
     */
    startRun(runId, agentId, config) {
        this.buffer.push({
            recordType: 'run_start',
            runId,
            agentId,
            config,
            timestamp: new Date().toISOString(),
        });
    }
    /**
     * Records a step execution.
     * @param step - The step record to log.
     */
    recordStep(step) {
        this.buffer.push({ ...step, recordType: 'step' });
    }
    /**
     * Records a guard event (loop detected, budget exceeded, etc.).
     * @param event - The guard event record to log.
     */
    recordGuardEvent(event) {
        this.buffer.push({ recordType: 'guard_event', event });
    }
    /**
     * Records the end of a run.
     * @param runId - The run identifier.
     * @param status - Final status (e.g., 'completed', 'failed', 'killed').
     * @param totalCost - Total USD cost of the run.
     */
    endRun(runId, status, totalCost) {
        this.buffer.push({
            recordType: 'run_end',
            runId,
            status,
            totalCost,
            timestamp: new Date().toISOString(),
        });
    }
    /**
     * Writes all buffered records to disk as JSONL (one JSON object per line).
     * Clears the buffer after writing.
     */
    async flush() {
        if (this.buffer.length === 0)
            return;
        const lines = this.buffer.map((entry) => JSON.stringify(entry)).join('\n') + '\n';
        this.buffer = [];
        try {
            await appendFile(this.outputPath, lines, 'utf-8');
        }
        catch (err) {
            // If file doesn't exist yet, create it
            if (err.code === 'ENOENT') {
                await writeFile(this.outputPath, lines, 'utf-8');
            }
            else {
                throw err;
            }
        }
    }
    /**
     * Returns the number of buffered (unflushed) records.
     */
    get pendingCount() {
        return this.buffer.length;
    }
    /**
     * Returns the buffered entries (for testing).
     */
    getBuffer() {
        return this.buffer;
    }
}
//# sourceMappingURL=trace-recorder.js.map