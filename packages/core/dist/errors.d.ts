import type { LoopSignal } from './types.js';
/**
 * Base error class for all Fuze errors.
 */
export declare class FuzeError extends Error {
    constructor(message: string);
}
/**
 * Thrown when a step or run exceeds its budget ceiling.
 *
 * @example
 * "BudgetExceeded: step 'analyse' estimated $0.60 but step ceiling is $0.50 (run spent $0.42 of $1.00)"
 */
export declare class BudgetExceeded extends FuzeError {
    /** The estimated cost that triggered the error. */
    readonly estimatedCost: number;
    /** The ceiling that was breached (step or run). */
    readonly ceiling: number;
    /** Total cost spent so far in the run. */
    readonly spent: number;
    /** Whether this was a step-level or run-level breach. */
    readonly level: 'step' | 'run';
    constructor(opts: {
        toolName: string;
        estimatedCost: number;
        ceiling: number;
        spent: number;
        level: 'step' | 'run';
    });
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