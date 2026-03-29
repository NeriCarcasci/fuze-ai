import { createHash, randomUUID } from 'node:crypto';
import { estimateCost } from './pricing.js';
import { LoopDetected, GuardTimeout } from './errors.js';
/**
 * Creates the guard wrapper function bound to a specific run context.
 * @param resolvedOpts - Fully resolved options for this run.
 * @param context - Shared run context (budget, loop, trace, side-effects).
 * @returns A function that wraps any sync/async function with protection.
 */
export function createGuardWrapper(resolvedOpts, context) {
    /**
     * Wraps a sync or async function with Fuze protection:
     * loop detection, budget enforcement, timeout, side-effect tracking, and trace recording.
     *
     * @param fn - The function to wrap.
     * @param options - Per-function guard options that override run-level config.
     * @returns A wrapped function with the same signature.
     */
    return function guard(fn, options) {
        const funcName = fn.name || 'anonymous';
        const opts = mergeStepOptions(resolvedOpts, options);
        // Register compensation if provided
        if (opts.compensate) {
            context.sideEffectRegistry.registerCompensation(funcName, opts.compensate);
        }
        const wrapped = async function (...args) {
            const stepId = randomUUID();
            const argsHash = hashArgs(args);
            const startedAt = new Date().toISOString();
            const startMs = Date.now();
            context.stepNumber++;
            // 1. Check loop detector — Layer 1: iteration cap
            const loopSignal = context.loopDetector.onStep();
            if (loopSignal) {
                context.traceRecorder.recordGuardEvent({
                    eventId: randomUUID(),
                    runId: context.runId,
                    stepId,
                    timestamp: new Date().toISOString(),
                    type: 'loop_detected',
                    severity: 'critical',
                    details: loopSignal.details,
                });
                await context.traceRecorder.flush();
                if (opts.onLoop === 'kill')
                    throw new LoopDetected(loopSignal, funcName);
                if (opts.onLoop === 'skip')
                    return undefined;
                // 'warn' — continue execution
            }
            // Layer 2: repeated tool call detection
            const toolSignature = `${funcName}:${argsHash}`;
            const toolSignal = context.loopDetector.onToolCall(toolSignature);
            if (toolSignal) {
                context.traceRecorder.recordGuardEvent({
                    eventId: randomUUID(),
                    runId: context.runId,
                    stepId,
                    timestamp: new Date().toISOString(),
                    type: 'loop_detected',
                    severity: 'action',
                    details: toolSignal.details,
                });
                if (opts.onLoop === 'kill') {
                    await context.traceRecorder.flush();
                    throw new LoopDetected(toolSignal, funcName);
                }
                if (opts.onLoop === 'skip')
                    return undefined;
            }
            // 2. Check budget
            const estimatedStepCost = opts.model
                ? estimateCost(opts.model, opts.estimatedTokensIn ?? 0, opts.estimatedTokensOut ?? 0)
                : 0;
            context.budgetTracker.checkBudget(estimatedStepCost, funcName);
            // 3. Execute with timeout
            let result;
            let error;
            try {
                if (opts.timeout < Infinity) {
                    let timer;
                    result = await Promise.race([
                        Promise.resolve(fn.apply(this, args)).finally(() => clearTimeout(timer)),
                        new Promise((_, reject) => {
                            timer = setTimeout(() => reject(new GuardTimeout(funcName, opts.timeout)), opts.timeout);
                        }),
                    ]);
                }
                else {
                    result = await Promise.resolve(fn.apply(this, args));
                }
            }
            catch (err) {
                error = err instanceof Error ? err.message : String(err);
                throw err;
            }
            finally {
                // 4. Record step
                const endedAt = new Date().toISOString();
                const latencyMs = Date.now() - startMs;
                context.traceRecorder.recordStep({
                    stepId,
                    runId: context.runId,
                    stepNumber: context.stepNumber,
                    startedAt,
                    endedAt,
                    toolName: funcName,
                    argsHash,
                    hasSideEffect: opts.sideEffect,
                    costUsd: estimatedStepCost,
                    tokensIn: opts.estimatedTokensIn ?? 0,
                    tokensOut: opts.estimatedTokensOut ?? 0,
                    latencyMs,
                    error,
                });
                // Record actual cost
                context.budgetTracker.recordCost(estimatedStepCost, opts.estimatedTokensIn ?? 0, opts.estimatedTokensOut ?? 0);
            }
            // 5. Check progress — Layer 3
            const hasNewOutput = result !== undefined && result !== null;
            const progressSignal = context.loopDetector.onProgress(hasNewOutput);
            if (progressSignal) {
                context.traceRecorder.recordGuardEvent({
                    eventId: randomUUID(),
                    runId: context.runId,
                    stepId,
                    timestamp: new Date().toISOString(),
                    type: 'loop_detected',
                    severity: 'warning',
                    details: progressSignal.details,
                });
                if (opts.onLoop === 'kill') {
                    await context.traceRecorder.flush();
                    throw new LoopDetected(progressSignal, funcName);
                }
            }
            // 6. Record side-effect if applicable
            if (opts.sideEffect) {
                context.sideEffectRegistry.recordSideEffect(stepId, funcName, result);
            }
            return result;
        };
        // Preserve function name for debugging
        Object.defineProperty(wrapped, 'name', { value: funcName, configurable: true });
        return wrapped;
    };
}
/**
 * Hashes function arguments using SHA-256 for dedup comparison.
 */
function hashArgs(args) {
    const hash = createHash('sha256');
    hash.update(JSON.stringify(args));
    return hash.digest('hex').slice(0, 16);
}
/**
 * Merges step-level options with resolved run-level options.
 */
function mergeStepOptions(resolved, step) {
    if (!step)
        return resolved;
    return {
        ...resolved,
        maxRetries: step.maxRetries ?? resolved.maxRetries,
        timeout: step.timeout ?? resolved.timeout,
        maxCostPerStep: step.maxCost ?? resolved.maxCostPerStep,
        maxIterations: step.maxIterations ?? resolved.maxIterations,
        onLoop: step.onLoop ?? resolved.onLoop,
        sideEffect: step.sideEffect ?? resolved.sideEffect,
        compensate: step.compensate ?? resolved.compensate,
        model: step.model ?? resolved.model,
        estimatedTokensIn: step.estimatedTokensIn ?? resolved.estimatedTokensIn,
        estimatedTokensOut: step.estimatedTokensOut ?? resolved.estimatedTokensOut,
    };
}
//# sourceMappingURL=guard.js.map