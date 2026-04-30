import { createHash, randomUUID } from 'node:crypto'
import type { GuardOptions, ResolvedOptions } from './types.js'
import { UsageTracker } from './budget-tracker.js'
import { ResourceLimitTracker } from './resource-limit-tracker.js'
import { LoopDetector } from './loop-detector.js'
import { SideEffectRegistry } from './side-effect-registry.js'
import { TraceRecorder } from './trace-recorder.js'
import type { FuzeService } from './services/index.js'
import { extractUsageFromResult } from './usage-extractor.js'
import { LoopDetected, GuardTimeout, FuzeError, ResourceLimitExceeded } from './errors.js'

/**
 * Internal context shared across all guarded functions in a run.
 */
export interface GuardContext {
  runId: string
  usageTracker: UsageTracker
  resourceLimitTracker: ResourceLimitTracker
  loopDetector: LoopDetector
  sideEffectRegistry: SideEffectRegistry
  traceRecorder: TraceRecorder
  stepNumber: number
  /** Service for telemetry + remote config - NoopService when no daemon/cloud configured. */
  service: FuzeService
}

/**
 * Creates the guard wrapper function bound to a specific run context.
 * @param resolvedOpts - Fully resolved options for this run.
 * @param context - Shared run context (usage, loop, trace, side-effects).
 * @returns A function that wraps any sync/async function with protection.
 */
export function createGuardWrapper(resolvedOpts: ResolvedOptions, context: GuardContext) {
  /**
   * Wraps a sync or async function with Fuze protection:
   * loop detection, timeout, side-effect tracking, and trace recording.
   *
   * @param fn - The function to wrap.
   * @param options - Per-function guard options that override run-level config.
   * @returns A wrapped function with the same signature.
   */
  return function guard<T extends (...args: unknown[]) => unknown>(
    fn: T,
    options?: GuardOptions,
  ): T {
    const funcName = fn.name || 'anonymous'
    const opts = mergeStepOptions(resolvedOpts, options)

    // Register compensation if provided
    if (opts.compensate) {
      context.sideEffectRegistry.registerCompensation(funcName, opts.compensate)
    }

    const wrapped = async function (this: unknown, ...args: unknown[]): Promise<unknown> {
      const stepId = randomUUID()
      const argsHash = hashArgs(args)
      const startedAt = new Date().toISOString()
      const startMs = Date.now()
      const stepNumber = ++context.stepNumber

      try {
        await context.resourceLimitTracker.checkAndReserveStep(funcName)
      } catch (limitError) {
        if (limitError instanceof ResourceLimitExceeded) {
          context.traceRecorder.recordGuardEvent({
            eventId: randomUUID(),
            runId: context.runId,
            stepId,
            timestamp: new Date().toISOString(),
            type: 'kill',
            severity: 'critical',
            details: { ...limitError.details },
          })
          fireAndForget(context.service.sendGuardEvent(context.runId, {
            stepId,
            eventType: 'kill',
            severity: 'critical',
            details: { ...limitError.details, cause: 'resource_limit_exceeded' },
          }))
          await context.traceRecorder.flush()
        }
        throw limitError
      }

      // 1. Check loop detector - Layer 1: iteration cap
      const loopSignal = context.loopDetector.onStep()
      if (loopSignal) {
        context.traceRecorder.recordGuardEvent({
          eventId: randomUUID(),
          runId: context.runId,
          stepId,
          timestamp: new Date().toISOString(),
          type: 'loop_detected',
          severity: 'critical',
          details: loopSignal.details,
        })
        fireAndForget(context.service.sendGuardEvent(context.runId, {
          stepId, eventType: 'loop_detected', severity: 'critical', details: loopSignal.details,
        }))
        await context.traceRecorder.flush()

        if (opts.onLoop === 'kill') throw new LoopDetected(loopSignal, funcName)
        if (opts.onLoop === 'skip') return undefined
        // 'warn' - continue execution
      }

      // Layer 2: repeated tool call detection
      const toolSignature = `${funcName}:${argsHash}`
      const toolSignal = context.loopDetector.onToolCall(toolSignature)
      if (toolSignal) {
        context.traceRecorder.recordGuardEvent({
          eventId: randomUUID(),
          runId: context.runId,
          stepId,
          timestamp: new Date().toISOString(),
          type: 'loop_detected',
          severity: 'action',
          details: toolSignal.details,
        })
        fireAndForget(context.service.sendGuardEvent(context.runId, {
          stepId, eventType: 'loop_detected', severity: 'action', details: toolSignal.details,
        }))

        if (opts.onLoop === 'kill') {
          await context.traceRecorder.flush()
          throw new LoopDetected(toolSignal, funcName)
        }
        if (opts.onLoop === 'skip') return undefined
      }

      // Apply remote config overrides (synchronous cache read - zero latency)
      let callOpts = { ...opts }
      const remoteConfig = context.service.getToolConfig(funcName)
      if (remoteConfig) {
        if (!remoteConfig.enabled) {
          throw new FuzeError(`Tool '${funcName}' is disabled via remote configuration`)
        }
        callOpts = {
          ...callOpts,
          maxRetries: remoteConfig.maxRetries,
          timeout: remoteConfig.timeout,
        }
      }

      // Check service (kill switch). Falls back to proceed if unavailable.
      const decision = await context.service.sendStepStart(context.runId, {
        stepId,
        stepNumber,
        toolName: funcName,
        argsHash,
        sideEffect: opts.sideEffect,
      })
      if (decision === 'kill') {
        throw new FuzeError('Transport kill: kill switch activated')
      }

      // 2. Execute with timeout + retry policy
      let result: unknown
      let error: string | undefined
      let timer: ReturnType<typeof setTimeout> | undefined
      let recordedTokensIn = 0
      let recordedTokensOut = 0

      const clearTimer = (): void => {
        if (timer !== undefined) {
          clearTimeout(timer)
          timer = undefined
        }
      }

      try {
        let attempt = 0
        let retriesRemaining = Math.max(0, callOpts.maxRetries)

        while (true) {
          attempt += 1
          try {
            if (callOpts.timeout < Infinity) {
              let timedOut = false
              const fnPromise = Promise.resolve(fn.apply(this, args))
                .catch((err: unknown) => {
                  if (timedOut) return undefined
                  throw err
                })
                .finally(() => {
                  clearTimer()
                })

              const timeoutPromise = new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                  timedOut = true
                  reject(new GuardTimeout(funcName, callOpts.timeout))
                }, callOpts.timeout)
              })

              result = await Promise.race([
                fnPromise,
                timeoutPromise,
              ])
            } else {
              result = await Promise.resolve(fn.apply(this, args))
            }

            break
          } catch (attemptError) {
            if (isNonRetryableError(attemptError) || retriesRemaining <= 0) {
              throw attemptError
            }

            retriesRemaining -= 1
            const backoffMs = Math.min(100 * (2 ** (attempt - 1)), 5000)
            const retryDetails = {
              attempt,
              nextAttempt: attempt + 1,
              retriesRemaining,
              maxRetries: callOpts.maxRetries,
              delayMs: backoffMs,
              error: attemptError instanceof Error ? attemptError.message : String(attemptError),
            }

            context.traceRecorder.recordGuardEvent({
              eventId: randomUUID(),
              runId: context.runId,
              stepId,
              timestamp: new Date().toISOString(),
              type: 'retry',
              severity: 'warning',
              details: retryDetails,
            })
            fireAndForget(context.service.sendGuardEvent(context.runId, {
              stepId,
              eventType: 'retry',
              severity: 'warning',
              details: retryDetails,
            }))

            await wait(backoffMs)
          } finally {
            clearTimer()
          }
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
        throw err
      } finally {
        clearTimer()

        // 3. Extract token usage from result (auto-detection or custom extractor)
        const endedAt = new Date().toISOString()
        const latencyMs = Date.now() - startMs

        const extracted = result !== undefined
          ? (callOpts.usageExtractor ? callOpts.usageExtractor(result) : extractUsageFromResult(result))
          : null

        if (extracted) {
          recordedTokensIn = extracted.tokensIn
          recordedTokensOut = extracted.tokensOut
        }

        context.traceRecorder.recordStep({
          stepId,
          runId: context.runId,
          stepNumber,
          startedAt,
          endedAt,
          toolName: funcName,
          argsHash,
          hasSideEffect: opts.sideEffect,
          tokensIn: recordedTokensIn,
          tokensOut: recordedTokensOut,
          latencyMs,
          error,
        })

        context.usageTracker.recordUsage(recordedTokensIn, recordedTokensOut)
        context.resourceLimitTracker.recordUsage(recordedTokensIn, recordedTokensOut)

        // Notify transport of step completion (fire-and-forget)
        fireAndForget(context.service.sendStepEnd(context.runId, stepId, {
          toolName: funcName,
          stepNumber,
          argsHash,
          hasSideEffect: opts.sideEffect,
          tokensIn: recordedTokensIn,
          tokensOut: recordedTokensOut,
          latencyMs,
          error: error ?? null,
        }))
      }

      // 4. Check progress - Layer 3 (no-progress detection)
      const hasNewOutput = result !== undefined && result !== null
      const progressSignal = context.loopDetector.onProgress(hasNewOutput)
      if (progressSignal) {
        context.traceRecorder.recordGuardEvent({
          eventId: randomUUID(),
          runId: context.runId,
          stepId: stepId,
          timestamp: new Date().toISOString(),
          type: 'loop_detected',
          severity: 'warning',
          details: progressSignal.details,
        })
        fireAndForget(context.service.sendGuardEvent(context.runId, {
          stepId, eventType: 'loop_detected', severity: 'warning', details: progressSignal.details,
        }))

        if (opts.onLoop === 'kill') {
          await context.traceRecorder.flush()
          throw new LoopDetected(progressSignal, funcName)
        }
      }

      // 5. Record side-effect if applicable
      if (opts.sideEffect) {
        context.sideEffectRegistry.recordSideEffect(stepId, funcName, result)
      }

      return result
    }

    // Preserve function name for debugging
    Object.defineProperty(wrapped, 'name', { value: funcName, configurable: true })

    return wrapped as unknown as T
  }
}

// Match Python's _hash_args: serialize as `{"args": [...], "kwargs": {...}}`
// with deep-sorted keys and compact separators, so positional-only JS calls
// produce the same hash bytes as Python `*args` calls with no kwargs. JS has
// no kwargs, so the kwargs object is always empty.
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'undefined') return 'null'
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalStringify).join(',') + ']'
  }
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalStringify(obj[k])).join(',') + '}'
}

function hashArgs(args: unknown[]): string {
  const hash = createHash('sha256')
  let serialized = '[unserializable]'
  try {
    serialized = canonicalStringify({ args, kwargs: {} })
  } catch {
    serialized = String(args)
  }
  hash.update(serialized)
  return hash.digest('hex').slice(0, 16)
}

function fireAndForget(promise: Promise<unknown>): void {
  promise.catch(() => undefined)
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isNonRetryableError(err: unknown): boolean {
  return err instanceof GuardTimeout || err instanceof LoopDetected
}

/**
 * Merges step-level options with resolved run-level options.
 */
export function mergeStepOptions(
  resolved: ResolvedOptions,
  step?: GuardOptions,
): ResolvedOptions {
  if (!step) return resolved

  return {
    ...resolved,
    maxRetries: step.maxRetries ?? resolved.maxRetries,
    timeout: step.timeout ?? resolved.timeout,
    maxIterations: step.maxIterations ?? resolved.maxIterations,
    onLoop: step.onLoop ?? resolved.onLoop,
    traceOutput: resolved.traceOutput,
    sideEffect: step.sideEffect ?? resolved.sideEffect,
    compensate: step.compensate ?? resolved.compensate,
    usageExtractor: step.usageExtractor ?? resolved.usageExtractor,
    loopDetection: { ...resolved.loopDetection, ...step.loopDetection },
  }
}
