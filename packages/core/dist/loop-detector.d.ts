import type { LoopDetectorConfig, LoopSignal } from './types.js';
/**
 * Detects agent loops using three layers:
 * - Layer 1: Hard iteration cap
 * - Layer 2: Sliding window hash dedup for repeated tool calls
 * - Layer 3: No-progress detection (consecutive steps with no novel output)
 */
export declare class LoopDetector {
    private readonly config;
    private iterationCount;
    private readonly toolCallWindow;
    private flatStepCount;
    constructor(config: LoopDetectorConfig);
    /**
     * Called every step. Checks Layer 1 (iteration cap).
     * @returns A LoopSignal if the iteration cap is reached, or null.
     */
    onStep(): LoopSignal | null;
    /**
     * Called every tool call with a signature hash of tool name + args.
     * Checks Layer 2 (sliding window dedup).
     * @param signature - Hash string identifying the tool call (e.g., "funcName:argsHash").
     * @returns A LoopSignal if repeated calls are detected, or null.
     */
    onToolCall(signature: string): LoopSignal | null;
    /**
     * Called after result analysis. Checks Layer 3 (no-progress detection).
     * @param hasNewSignal - Whether the step produced novel output.
     * @returns A LoopSignal if too many steps without progress, or null.
     */
    onProgress(hasNewSignal: boolean): LoopSignal | null;
    /**
     * Resets the detector state. Useful when starting a new run.
     */
    reset(): void;
}
//# sourceMappingURL=loop-detector.d.ts.map