import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { ConfigLoader } from './config-loader.js'
import { UsageTracker } from './budget-tracker.js'
import { ResourceLimitTracker } from './resource-limit-tracker.js'
import { LoopDetector } from './loop-detector.js'
import { SideEffectRegistry } from './side-effect-registry.js'
import { TraceRecorder } from './trace-recorder.js'
import type { GuardOptions } from './types.js'
import { createGuardWrapper } from './guard.js'
import type { GuardContext } from './guard.js'
import { ensureConfig, getOrCreateService } from './service-singleton.js'

const ALS = new AsyncLocalStorage<GuardContext>()

function fireAndForget(promise: Promise<unknown>): void {
  promise.catch(() => undefined)
}

function buildContext(resolved: ReturnType<typeof ConfigLoader.merge>, runId: string): GuardContext {
  const config = ensureConfig()
  const service = getOrCreateService(config)
  return {
    runId,
    usageTracker: new UsageTracker(),
    resourceLimitTracker: new ResourceLimitTracker(resolved.resourceLimits),
    loopDetector: new LoopDetector({
      ...resolved.loopDetection,
      maxIterations: resolved.maxIterations,
    }),
    sideEffectRegistry: new SideEffectRegistry(),
    traceRecorder: new TraceRecorder(resolved.traceOutput),
    stepNumber: 0,
    service,
  }
}

// Each decorated method call routes through here. If a parent run is already
// active in async-local storage (because we're inside another guarded call on
// the same instance), we record this call as a step in that run. Otherwise we
// open a fresh run, scope it in ALS for the duration of the call, and close it.
export async function runDecoratedCall(
  originalFn: (...args: unknown[]) => unknown,
  thisArg: unknown,
  args: unknown[],
  methodName: string,
  options: GuardOptions | undefined,
): Promise<unknown> {
  const config = ensureConfig()
  const resolved = ConfigLoader.merge(config, options)

  const ambient = ALS.getStore()
  if (ambient) {
    const wrap = createGuardWrapper(resolved, ambient)
    const wrapped = wrap(originalFn as never, options)
    return (wrapped as (this: unknown, ...args: unknown[]) => Promise<unknown>).apply(thisArg, args)
  }

  const runId = randomUUID()
  const ctx = buildContext(resolved, runId)
  ctx.traceRecorder.startRun(runId, methodName, resolved)
  fireAndForget(ctx.service.sendRunStart(runId, methodName, {}))

  const wrap = createGuardWrapper(resolved, ctx)
  const wrapped = wrap(originalFn as never, options)

  return ALS.run(ctx, async () => {
    let status: 'completed' | 'error' = 'completed'
    try {
      return await (wrapped as (this: unknown, ...args: unknown[]) => Promise<unknown>).apply(thisArg, args)
    } catch (err) {
      status = 'error'
      throw err
    } finally {
      ctx.traceRecorder.endRun(runId, status)
      await ctx.traceRecorder.flush()
      fireAndForget(ctx.service.sendRunEnd(runId, status))
    }
  })
}

const WRAPPED_MARKER = Symbol.for('fuze-ai.decorated')

export function isAlreadyDecorated(fn: unknown): boolean {
  return typeof fn === 'function' && (fn as unknown as { [k: symbol]: unknown })[WRAPPED_MARKER] === true
}

export function markDecorated<T extends object>(fn: T): T {
  Object.defineProperty(fn, WRAPPED_MARKER, { value: true, configurable: false, enumerable: false })
  return fn
}
