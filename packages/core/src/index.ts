import { randomUUID } from 'node:crypto'
import type { FuzeConfig, GuardOptions, RunContext } from './types.js'
import { DEFAULTS } from './types.js'
import { ConfigLoader } from './config-loader.js'
import { BudgetTracker } from './budget-tracker.js'
import { LoopDetector } from './loop-detector.js'
import { SideEffectRegistry } from './side-effect-registry.js'
import { TraceRecorder } from './trace-recorder.js'
import { createGuardWrapper } from './guard.js'
import type { GuardContext } from './guard.js'
import { mergePricing } from './pricing.js'

// Re-export public types
export type { GuardOptions, FuzeConfig, RunContext } from './types.js'
export { BudgetExceeded, LoopDetected, GuardTimeout, FuzeError } from './errors.js'

// Global configuration state
let globalConfig: FuzeConfig = {}
let configLoaded = false

/**
 * Ensures the global config has been loaded from fuze.toml (once).
 */
function ensureConfig(): FuzeConfig {
  if (!configLoaded) {
    try {
      globalConfig = { ...ConfigLoader.load(), ...globalConfig }
    } catch {
      // If fuze.toml is missing or invalid, use empty config (defaults apply)
    }
    configLoaded = true
  }
  return globalConfig
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
export function configure(config: FuzeConfig): void {
  globalConfig = config
  configLoaded = true

  // Merge any custom provider pricing
  if (config.providers) {
    mergePricing(config.providers)
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
export function guard<T extends (...args: unknown[]) => unknown>(
  fn: T,
  options?: GuardOptions,
): T {
  const config = ensureConfig()
  const resolved = ConfigLoader.merge(config, options)

  const context: GuardContext = {
    runId: randomUUID(),
    budgetTracker: new BudgetTracker(resolved.maxCostPerStep, resolved.maxCostPerRun),
    loopDetector: new LoopDetector({
      ...resolved.loopDetection,
      maxIterations: resolved.maxIterations,
    }),
    sideEffectRegistry: new SideEffectRegistry(),
    traceRecorder: new TraceRecorder(resolved.traceOutput),
    stepNumber: 0,
  }

  const guardFn = createGuardWrapper(resolved, context)
  return guardFn(fn, options)
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
export function createRun(agentId = 'default', options?: GuardOptions): RunContext {
  const config = ensureConfig()
  const resolved = ConfigLoader.merge(config, options)
  const runId = randomUUID()

  const context: GuardContext = {
    runId,
    budgetTracker: new BudgetTracker(resolved.maxCostPerStep, resolved.maxCostPerRun),
    loopDetector: new LoopDetector({
      ...resolved.loopDetection,
      maxIterations: resolved.maxIterations,
    }),
    sideEffectRegistry: new SideEffectRegistry(),
    traceRecorder: new TraceRecorder(resolved.traceOutput),
    stepNumber: 0,
  }

  context.traceRecorder.startRun(runId, agentId, resolved)

  const guardFn = createGuardWrapper(resolved, context)

  return {
    runId,
    guard: <T extends (...args: unknown[]) => unknown>(fn: T, stepOptions?: GuardOptions): T => {
      return guardFn(fn, stepOptions)
    },
    getStatus: () => context.budgetTracker.getStatus(),
    end: async (status = 'completed') => {
      const { totalCost } = context.budgetTracker.getStatus()
      context.traceRecorder.endRun(runId, status, totalCost)
      await context.traceRecorder.flush()
    },
  }
}

/**
 * Resets global configuration state (used in testing).
 */
export function resetConfig(): void {
  globalConfig = {}
  configLoaded = false
}
