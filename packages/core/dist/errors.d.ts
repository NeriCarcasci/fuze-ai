import type { LoopSignal } from './types.js';
/**
 * Base error class for all Fuze errors.
 */
export declare class FuzeError extends Error {
    constructor(message: string);
}
/**
 * Thrown when the loop detector identifies a loop condition.
 */
export declare class LoopDetected extends FuzeError {
    /** The loop signal that triggered this error. */
    readonly signal: LoopSignal;
    constructor(signal: LoopSignal, toolName?: string);
}
/**
 * Thrown when a guarded function exceeds its timeout.
 */
export declare class GuardTimeout extends FuzeError {
    /** The timeout duration in milliseconds. */
    readonly timeoutMs: number;
    constructor(toolName: string, timeoutMs: number);
}
//# sourceMappingURL=errors.d.ts.map