import { randomUUID } from 'node:crypto'
import type { FuzeConfig, GuardOptions, RunContext } from './types.js'
import { ConfigLoader } from './config-loader.js'
import { UsageTracker } from './budget-tracker.js'
import { LoopDetector } from './loop-detector.js'
import { SideEffectRegistry } from './side-effect-registry.js'
import { TraceRecorder } from './trace-recorder.js'
import { createService } from './services/index.js'
import type { FuzeService, ToolRegistration } from './services/index.js'
import { createGuardWrapper } from './guard.js'
import type { GuardContext } from './guard.js'

// Module-level service singleton — one connection per process, lazily created.
let _service: FuzeService | null = null

function getOrCreateService(config: FuzeConfig): FuzeService {
  if (!_service) {
    _service = createService(config)
    fireAndForget(_service.connect())
  }
  return _service
}

function fireAndForget(promise: Promise<unknown>): void {
  promise.catch(() => undefined)
}

function mergeOptional<T extends object>(base: T | undefined, override: T | undefined): T | undefined {
  if (!base && !override) return undefined
  return { ...(base ?? {}), ...(override ?? {}) } as T
}

function mergeConfigs(base: FuzeConfig, override: FuzeConfig): FuzeConfig {
  return {
    ...base,
    ...override,
    defaults: mergeOptional(base.defaults, override.defaults),
    loopDetection: mergeOptional(base.loopDetection, override.loopDetection),
    daemon: mergeOptional(base.daemon, override.daemon),
    cloud: mergeOptional(base.cloud, override.cloud),
    project: mergeOptional(base.project, override.project),
    usageExtractor: override.usageExtractor ?? base.usageExtractor,
  }
}

// Re-export public types
export type { GuardOptions, FuzeConfig, RunContext } from './types.js'
export { LoopDetected, GuardTimeout, FuzeError } from './errors.js'
export { extractUsageFromResult } from './pricing.js'
export type { ExtractedUsage } from './pricing.js'
export { TraceRecorder, verifyChain } from './trace-recorder.js'
export type { TraceEntry, SignedTraceEntry, VerifyChainResult } from './trace-recorder.js'

// FuzeService — new bidirectional service interface
export type { FuzeService, ToolRegistration, ToolConfig } from './services/index.js'
export { createService, ApiService, DaemonService, NoopService } from './services/index.js'

// Global configuration state
let globalConfig: FuzeConfig = {}
let configLoaded = false

/**
 * Ensures the global config has been loaded from fuze.toml (once).
 */
function ensureConfig(): FuzeConfig {
  if (!configLoaded) {
    try {
      globalConfig = mergeConfigs(ConfigLoader.load(), globalConfig)
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
 *   defaults: { maxRetries: 3, timeout: 30000 },
 * })
 * ```
 */
export function configure(config: FuzeConfig): void {
  globalConfig = mergeConfigs(globalConfig, config)
  configLoaded = false

  // Reset service so it picks up new config (cloud key, socket path, etc.)
  if (_service) {
    fireAndForget(_service.disconnect())
    _service = null
  }
}

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
export function guard<T extends (...args: unknown[]) => unknown>(
  fn: T,
  options?: GuardOptions,
): T {
  const config = ensureConfig()
  const resolved = ConfigLoader.merge(config, options)
  const runId = randomUUID()
  const service = getOrCreateService(config)

  const context: GuardContext = {
    runId,
    usageTracker: new UsageTracker(),
    loopDetector: new LoopDetector({
      ...resolved.loopDetection,
      maxIterations: resolved.maxIterations,
    }),
    sideEffectRegistry: new SideEffectRegistry(),
    traceRecorder: new TraceRecorder(resolved.traceOutput),
    stepNumber: 0,
    service,
  }

  fireAndForget(service.sendRunStart(runId, fn.name || 'anonymous', {}))

  const guardFn = createGuardWrapper(resolved, context)
  return guardFn(fn, options)
}

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
export function createRun(agentId = 'default', options?: GuardOptions): RunContext {
  const config = ensureConfig()
  const resolved = ConfigLoader.merge(config, options)
  const runId = randomUUID()
  const service = getOrCreateService(config)

  const context: GuardContext = {
    runId,
    usageTracker: new UsageTracker(),
    loopDetector: new LoopDetector({
      ...resolved.loopDetection,
      maxIterations: resolved.maxIterations,
    }),
    sideEffectRegistry: new SideEffectRegistry(),
    traceRecorder: new TraceRecorder(resolved.traceOutput),
    stepNumber: 0,
    service,
  }

  context.traceRecorder.startRun(runId, agentId, resolved)
  fireAndForget(service.sendRunStart(runId, agentId, {}))

  const guardFn = createGuardWrapper(resolved, context)

  return {
    runId,
    guard: <T extends (...args: unknown[]) => unknown>(fn: T, stepOptions?: GuardOptions): T => {
      return guardFn(fn, stepOptions)
    },
    getStatus: () => context.usageTracker.getStatus(),
    end: async (status = 'completed') => {
      context.traceRecorder.endRun(runId, status)
      await context.traceRecorder.flush()
      await service.sendRunEnd(runId, status)
    },
  }
}

/**
 * Resets global configuration state (used in testing).
 */
export function resetConfig(): void {
  globalConfig = {}
  configLoaded = false
  if (_service) {
    fireAndForget(_service.disconnect())
    _service = null
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
 *   { name: 'search', description: 'Vector search', sideEffect: false, defaults: { maxRetries: 3, timeout: 30000 } },
 *   { name: 'sendEmail', description: 'Send email', sideEffect: true, defaults: { maxRetries: 1, timeout: 10000 } },
 * ])
 * ```
 */
export function registerTools(tools: ToolRegistration[]): void {
  const config = ensureConfig()
  const service = getOrCreateService(config)
  const projectId = config.project?.projectId ?? process.env['FUZE_PROJECT_ID'] ?? 'default'
  fireAndForget(service.registerTools(projectId, tools))
}
