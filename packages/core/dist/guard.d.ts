import type { GuardOptions, ResolvedOptions } from './types.js';
import { BudgetTracker } from './budget-tracker.js';
import { LoopDetector } from './loop-detector.js';
import { SideEffectRegistry } from './side-effect-registry.js';
import { TraceRecorder } from './trace-recorder.js';
import type { TelemetryTransport } from './transports/index.js';
/**
 * Internal context shared across all guarded functions in a run.
 */
export interface GuardContext {
    runId: string;
    budgetTracker: BudgetTracker;
    loopDetector: LoopDetector;
    sideEffectRegistry: SideEffectRegistry;
    traceRecorder: TraceRecorder;
    stepNumber: number;
    /** Transport for telemetry — NoopTransport when no daemon/cloud configured. */
    transport: TelemetryTransport;
}
/**
 * Creates the guard wrapper function bound to a specific run context.
 * @param resolvedOpts - Fully resolved options for this run.
 * @param context - Shared run context (budget, loop, trace, side-effects).
 * @returns A function that wraps any sync/async function with protection.
 */
export declare function createGuardWrapper(resolvedOpts: ResolvedOptions, context: GuardContext): <T extends (...args: unknown[]) => unknown>(fn: T, options?: GuardOptions) => T;
//# sourceMappingURL=guard.d.ts.map