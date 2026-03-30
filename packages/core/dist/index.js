import { randomUUID } from 'node:crypto';
import { ConfigLoader } from './config-loader.js';
import { BudgetTracker } from './budget-tracker.js';
import { LoopDetector } from './loop-detector.js';
import { SideEffectRegistry } from './side-effect-registry.js';
import { TraceRecorder } from './trace-recorder.js';
import { createService } from './services/index.js';
import { createGuardWrapper } from './guard.js';
import { mergePricing } from './pricing.js';
// Module-level service singleton — one connection per process, lazily created.
let _service = null;
function getOrCreateService(config) {
    if (!_service) {
        _service = createService(config);
        void _service.connect();
    }
    return _service;
}
export { BudgetExceeded, LoopDetected, GuardTimeout, FuzeError } from './errors.js';
export { extractUsageFromResult } from './pricing.js';
export { createService, ApiService, DaemonService, NoopService } from './services/index.js';
/** @deprecated Use FuzeService / createService() instead. */
export { createTransport, NoopTransport, SocketTransport, CloudTransport } from './transports/index.js';
// Global configuration state
let globalConfig = {};
let configLoaded = false;
/**
 * Ensures the global config has been loaded from fuze.toml (once).
 */
function ensureConfig() {
    if (!configLoaded) {
        try {
            globalConfig = { ...ConfigLoader.load(), ...globalConfig };
        }
        catch {
            // If fuze.toml is missing or invalid, use empty config (defaults apply)
        }
        configLoaded = true;
    }
    return globalConfig;
}
/**
 * Set global configuration programmatically (alternative to fuze.toml).
 * Values set here override fuze.toml values.
 *
 * @param config - The configuration to apply globally.
 *
 * @example
 * ```ts
 * import { configure } from 'fuze-ai'
 *
 * configure({
 *   defaults: { maxRetries: 3, timeout: 30000, maxCostPerRun: 10.0 },
 *   providers: { 'openai/gpt-4o': { input: 0.0025, output: 0.01 } }
 * })
 * ```
 */
export function configure(config) {
    globalConfig = config;
    configLoaded = true;
    // Merge any custom provider pricing
    if (config.providers) {
        mergePricing(config.providers);
    }
    // Reset service so it picks up new config (cloud key, socket path, etc.)
    if (_service) {
        _service.disconnect();
        _service = null;
    }
}
/**
 * Wraps any sync or async function with Fuze protection.
 *
 * Creates an implicit single-step run context. For multi-step runs
 * that share budget and loop detection state, use `createRun()` instead.
 *
 * @param fn - The function to wrap.
 * @param options - Per-function guard options.
 * @returns A wrapped function with the same signature.
 *
 * @example
 * ```ts
 * import { guard } from 'fuze-ai'
 *
 * const search = guard(async (query: string) => {
 *   return await vectorDb.search(query)
 * })
 *
 * const sendInvoice = guard(
 *   async (customerId: string, amount: number) => {
 *     return stripe.createInvoice(customerId, amount)
 *   },
 *   { sideEffect: true, maxCost: 0.50 }
 * )
 * ```
 */
export function guard(fn, options) {
    const config = ensureConfig();
    const resolved = ConfigLoader.merge(config, options);
    const runId = randomUUID();
    const service = getOrCreateService(config);
    const context = {
        runId,
        budgetTracker: new BudgetTracker(resolved.maxCostPerStep, resolved.maxCostPerRun),
        loopDetector: new LoopDetector({
            ...resolved.loopDetection,
            maxIterations: resolved.maxIterations,
        }),
        sideEffectRegistry: new SideEffectRegistry(),
        traceRecorder: new TraceRecorder(resolved.traceOutput),
        stepNumber: 0,
        service,
    };
    void service.sendRunStart(runId, fn.name || 'anonymous', {});
    const guardFn = createGuardWrapper(resolved, context);
    return guardFn(fn, options);
}
/**
 * Creates a scoped run context with shared BudgetTracker, LoopDetector,
 * and TraceRecorder across all guarded steps.
 *
 * @param agentId - An identifier for the agent/caller. Default: 'default'.
 * @param options - Guard options that apply to all steps in this run.
 * @returns A RunContext with its own `guard()`, `getStatus()`, and `end()` methods.
 *
 * @example
 * ```ts
 * import { createRun } from 'fuze-ai'
 *
 * const run = createRun('research-agent', { maxCostPerRun: 5.0 })
 * const search = run.guard(searchFn)
 * const analyse = run.guard(analyseFn, { maxCost: 1.0 })
 *
 * await search('query')
 * await analyse('data')
 *
 * console.log(run.getStatus()) // { totalCost, totalTokensIn, ... }
 * await run.end()
 * ```
 */
export function createRun(agentId = 'default', options) {
    const config = ensureConfig();
    const resolved = ConfigLoader.merge(config, options);
    const runId = randomUUID();
    const service = getOrCreateService(config);
    const context = {
        runId,
        budgetTracker: new BudgetTracker(resolved.maxCostPerStep, resolved.maxCostPerRun),
        loopDetector: new LoopDetector({
            ...resolved.loopDetection,
            maxIterations: resolved.maxIterations,
        }),
        sideEffectRegistry: new SideEffectRegistry(),
        traceRecorder: new TraceRecorder(resolved.traceOutput),
        stepNumber: 0,
        service,
    };
    context.traceRecorder.startRun(runId, agentId, resolved);
    void service.sendRunStart(runId, agentId, {});
    const guardFn = createGuardWrapper(resolved, context);
    return {
        runId,
        guard: (fn, stepOptions) => {
            return guardFn(fn, stepOptions);
        },
        getStatus: () => context.budgetTracker.getStatus(),
        end: async (status = 'completed') => {
            const { totalCost } = context.budgetTracker.getStatus();
            context.traceRecorder.endRun(runId, status, totalCost);
            await context.traceRecorder.flush();
            await service.sendRunEnd(runId, status, totalCost);
        },
    };
}
/**
 * Resets global configuration state (used in testing).
 */
export function resetConfig() {
    globalConfig = {};
    configLoaded = false;
    if (_service) {
        _service.disconnect();
        _service = null;
    }
}
/**
 * Register tools with Fuze API/daemon at boot time.
 * Call once during application startup, before running any agents.
 * If no API key or daemon is configured, this is a no-op.
 *
 * @example
 * ```ts
 * import { registerTools } from 'fuze-ai'
 *
 * registerTools([
 *   { name: 'search', description: 'Vector search', sideEffect: false, defaults: { maxRetries: 3, maxBudget: 0.5, timeout: 30000 } },
 *   { name: 'sendEmail', description: 'Send email', sideEffect: true, defaults: { maxRetries: 1, maxBudget: 0.1, timeout: 10000 } },
 * ])
 * ```
 */
export function registerTools(tools) {
    const config = ensureConfig();
    const service = getOrCreateService(config);
    const projectId = config.project?.projectId ?? process.env['FUZE_PROJECT_ID'] ?? 'default';
    void service.registerTools(projectId, tools);
}
//# sourceMappingURL=index.js.map