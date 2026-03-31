import { createHash, randomUUID } from 'node:crypto'
import type { GuardOptions, ResolvedOptions } from './types.js'
import { BudgetTracker } from './budget-tracker.js'
import { LoopDetector } from './loop-detector.js'
import { SideEffectRegistry } from './side-effect-registry.js'
import { TraceRecorder } from './trace-recorder.js'
import type { FuzeService } from './services/index.js'
import { estimateCost, extractUsageFromResult, estimateFromArgs } from './pricing.js'
import { LoopDetected, GuardTimeout, FuzeError } from './errors.js'

/**
 * Internal context shared across all guarded functions in a run.
 */
export interface GuardContext {
  runId: string
  budgetTracker: BudgetTracker
  loopDetector: LoopDetector
  sideEffectRegistry: SideEffectRegistry
  traceRecorder: TraceRecorder
  stepNumber: number
  /** Service for telemetry + remote config — NoopService when no daemon/cloud configured. */
  service: FuzeService
}

/**
 * Creates the guard wrapper function bound to a specific run context.
 * @param resolvedOpts - Fully resolved options for this run.
 * @param context - Shared run context (budget, loop, trace, side-effects).
 * @returns A function that wraps any sync/async function with protection.
 */
export function createGuardWrapper(resolvedOpts: ResolvedOptions, context: GuardContext) {
  /**
   * Wraps a sync or async function with Fuze protection:
   * loop detection, budget enforcement, timeout, side-effect tracking, and trace recording.
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

      context.stepNumber++

      // 1. Check loop detector — Layer 1: iteration cap
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
        void context.service.sendGuardEvent(context.runId, {
          stepId, eventType: 'loop_detected', severity: 'critical', details: loopSignal.details,
        })
        await context.traceRecorder.flush()

        if (opts.onLoop === 'kill') throw new LoopDetected(loopSignal, funcName)
        if (opts.onLoop === 'skip') return undefined
        // 'warn' — continue execution
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
        void context.service.sendGuardEvent(context.runId, {
          stepId, eventType: 'loop_detected', severity: 'action', details: toolSignal.details,
        })

        if (opts.onLoop === 'kill') {
          await context.traceRecorder.flush()
          throw new LoopDetected(toolSignal, funcName)
        }
        if (opts.onLoop === 'skip') return undefined
      }

      // Apply remote config overrides (synchronous cache read — zero latency)
      let callOpts = { ...opts }
      const remoteConfig = context.service.getToolConfig(funcName)
      if (remoteConfig) {
        if (!remoteConfig.enabled) {
          throw new FuzeError(`Tool '${funcName}' is disabled via remote configuration`)
        }
        callOpts = {
          ...callOpts,
          maxCostPerStep: Math.min(callOpts.maxCostPerStep ?? Infinity, remoteConfig.maxBudget),
          maxRetries: remoteConfig.maxRetries,
          timeout: remoteConfig.timeout,
        }
      }

      // 2. Pre-flight budget check — use manual estimates if provided, otherwise estimate from args
      const preflightCost =
        callOpts.model && (callOpts.estimatedTokensIn !== undefined || callOpts.estimatedTokensOut !== undefined)
          ? estimateCost(callOpts.model, callOpts.estimatedTokensIn ?? 0, callOpts.estimatedTokensOut ?? 0)
          : estimateFromArgs(args, callOpts.model)
      context.budgetTracker.checkBudget(preflightCost, funcName)

      // 2b. Check service (org-level budget, kill switch). Falls back to proceed if unavailable.
      const decision = await context.service.sendStepStart(context.runId, {
        stepId,
        stepNumber: context.stepNumber,
        toolName: funcName,
        argsHash,
        sideEffect: opts.sideEffect,
      })
      if (decision === 'kill') {
        throw new FuzeError('Transport kill: budget exceeded or kill switch activated')
      }

      // 3. Execute with timeout
      let result: unknown
      let error: string | undefined

      try {
        if (callOpts.timeout < Infinity) {
          let timer: ReturnType<typeof setTimeout>
          result = await Promise.race([
            Promise.resolve(fn.apply(this, args)).finally(() => clearTimeout(timer)),
            new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new GuardTimeout(funcName, callOpts.timeout)), callOpts.timeout)
            }),
          ])
        } else {
          result = await Promise.resolve(fn.apply(this, args))
        }
      } catch (err) {
        error = err instanceof Error ? err.message : String(err)
        throw err
      } finally {
        // 4. Extract actual cost from result (auto-detection or custom extractor)
        const endedAt = new Date().toISOString()
        const latencyMs = Date.now() - startMs

        const extracted = result !== undefined
          ? (callOpts.costExtractor ? callOpts.costExtractor(result) : extractUsageFromResult(result))
          : null

        let actualCost: number
        let actualTokensIn: number
        let actualTokensOut: number

        if (extracted) {
          const modelForPricing = (extracted as { model?: string }).model ?? callOpts.model
          actualCost = modelForPricing
            ? estimateCost(modelForPricing, extracted.tokensIn, extracted.tokensOut)
            : preflightCost
          actualTokensIn = extracted.tokensIn
          actualTokensOut = extracted.tokensOut
        } else {
          actualCost = preflightCost
          actualTokensIn = callOpts.estimatedTokensIn ?? 0
          actualTokensOut = callOpts.estimatedTokensOut ?? 0
        }

        context.traceRecorder.recordStep({
          stepId,
          runId: context.runId,
          stepNumber: context.stepNumber,
          startedAt,
          endedAt,
          toolName: funcName,
          argsHash,
          hasSideEffect: opts.sideEffect,
          costUsd: actualCost,
          tokensIn: actualTokensIn,
          tokensOut: actualTokensOut,
          latencyMs,
          error,
        })

        context.budgetTracker.recordCost(actualCost, actualTokensIn, actualTokensOut)

        // Notify transport of step completion (fire-and-forget)
        void context.service.sendStepEnd(context.runId, stepId, {
          toolName: funcName,
          stepNumber: context.stepNumber,
          argsHash,
          hasSideEffect: opts.sideEffect,
          costUsd: actualCost,
          tokensIn: actualTokensIn,
          tokensOut: actualTokensOut,
          latencyMs,
          error: error ?? null,
        })
      }

      // 5. Check progress — Layer 3
      const hasNewOutput = result !== undefined && result !== null
      const progressSignal = context.loopDetector.onProgress(hasNewOutput)
      if (progressSignal) {
        context.traceRecorder.recordGuardEvent({
          eventId: randomUUID(),
          runId: context.runId,
          stepId,
          timestamp: new Date().toISOString(),
          type: 'loop_detected',
          severity: 'warning',
          details: progressSignal.details,
        })
        void context.service.sendGuardEvent(context.runId, {
          stepId, eventType: 'loop_detected', severity: 'warning', details: progressSignal.details,
        })

        if (opts.onLoop === 'kill') {
          await context.traceRecorder.flush()
          throw new LoopDetected(progressSignal, funcName)
        }
      }

      // 6. Record side-effect if applicable
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

/**
 * Hashes function arguments using SHA-256 for dedup comparison.
 */
function hashArgs(args: unknown[]): string {
  const hash = createHash('sha256')
  hash.update(JSON.stringify(args))
  return hash.digest('hex').slice(0, 16)
}

/**
 * Merges step-level options with resolved run-level options.
 */
function mergeStepOptions(
  resolved: ResolvedOptions,
  step?: GuardOptions,
): ResolvedOptions {
  if (!step) return resolved

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
    costExtractor: step.costExtractor ?? resolved.costExtractor,
    estimatedTokensIn: step.estimatedTokensIn ?? resolved.estimatedTokensIn,
    estimatedTokensOut: step.estimatedTokensOut ?? resolved.estimatedTokensOut,
  }
}
