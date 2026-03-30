import type { FuzeConfig, GuardOptions, RunContext } from './types.js';
import type { ToolRegistration } from './services/index.js';
export type { GuardOptions, FuzeConfig, RunContext } from './types.js';
export { BudgetExceeded, LoopDetected, GuardTimeout, FuzeError } from './errors.js';
export { extractUsageFromResult } from './pricing.js';
export type { ExtractedUsage } from './pricing.js';
export type { FuzeService, ToolRegistration, ToolConfig } from './services/index.js';
export { createService, ApiService, DaemonService, NoopService } from './services/index.js';
/** @deprecated Use FuzeService / createService() instead. */
export { createTransport, NoopTransport, SocketTransport, CloudTransport } from './transports/index.js';
/** @deprecated Use FuzeService instead. */
export type { TelemetryTransport } from './transports/index.js';
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
export declare function configure(config: FuzeConfig): void;
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
export declare function guard<T extends (...args: unknown[]) => unknown>(fn: T, options?: GuardOptions): T;
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
 *   { name: 'search', description: 'Vector search', sideEffect: false, defaults: { maxRetries: 3, maxBudget: 0.5, timeout: 30000 } },
 *   { name: 'sendEmail', description: 'Send email', sideEffect: true, defaults: { maxRetries: 1, maxBudget: 0.1, timeout: 10000 } },
 * ])
 * ```
 */
export declare function registerTools(tools: ToolRegistration[]): void;
//# sourceMappingURL=index.d.ts.map