import type { FuzeConfig, GuardOptions, RunContext } from './types.js';
import type { ToolRegistration } from './services/index.js';
export type { GuardOptions, FuzeConfig, RunContext } from './types.js';
export { LoopDetected, GuardTimeout, FuzeError } from './errors.js';
export { extractUsageFromResult } from './pricing.js';
export type { ExtractedUsage } from './pricing.js';
export { TraceRecorder, verifyChain } from './trace-recorder.js';
export type { TraceEntry, SignedTraceEntry, VerifyChainResult } from './trace-recorder.js';
export type { FuzeService, ToolRegistration, ToolConfig } from './services/index.js';
export { createService, ApiService, DaemonService, NoopService } from './services/index.js';
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
 *   defaults: { maxRetries: 3, timeout: 30000 },
 * })
 * ```
 */
export declare function configure(config: FuzeConfig): void;
/**
 * Wraps any sync or async function with Fuze protection.
 *
 * Creates an implicit single-step run context. For multi-step runs
 * that share loop detection state, use `createRun()` instead.
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
 *   { sideEffect: true }
 * )
 * ```
 */
export declare function guard<T extends (...args: unknown[]) => unknown>(fn: T, options?: GuardOptions): T;
/**
 * Creates a scoped run context with shared UsageTracker, LoopDetector,
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
 * const run = createRun('research-agent', { maxIterations: 50 })
 * const search = run.guard(searchFn)
 * const analyse = run.guard(analyseFn)
 *
 * await search('query')
 * await analyse('data')
 *
 * console.log(run.getStatus()) // { totalTokensIn, totalTokensOut, stepCount }
 * await run.end()
 * ```
 */
export declare function createRun(agentId?: string, options?: GuardOptions): RunContext;
/**
 * Resets global configuration state (used in testing).
 */
export declare function resetConfig(): void;
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
 *   { name: 'search', description: 'Vector search', sideEffect: false, defaults: { maxRetries: 3, timeout: 30000 } },
 *   { name: 'sendEmail', description: 'Send email', sideEffect: true, defaults: { maxRetries: 1, timeout: 10000 } },
 * ])
 * ```
 */
export declare function registerTools(tools: ToolRegistration[]): void;
//# sourceMappingURL=index.d.ts.map