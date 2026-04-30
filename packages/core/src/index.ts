import { randomUUID } from 'node:crypto'
import type { FuzeConfig, GuardOptions, RunContext } from './types.js'
import { ConfigLoader } from './config-loader.js'
import { UsageTracker } from './budget-tracker.js'
import { ResourceLimitTracker } from './resource-limit-tracker.js'
import { LoopDetector } from './loop-detector.js'
import { SideEffectRegistry } from './side-effect-registry.js'
import { TraceRecorder } from './trace-recorder.js'
import type { ToolRegistration } from './services/index.js'
import { createGuardWrapper } from './guard.js'
import type { GuardContext } from './guard.js'
import {
  ensureConfig,
  getOrCreateService,
  applyConfigure,
  applyResetConfig,
} from './service-singleton.js'

function fireAndForget(promise: Promise<unknown>): void {
  promise.catch(() => undefined)
}

export type { GuardOptions, FuzeConfig, RunContext, ResourceLimits, ResourceUsageStatus, UsageStatus } from './types.js'
export { LoopDetected, GuardTimeout, FuzeError, ResourceLimitExceeded } from './errors.js'
export { ResourceLimitTracker } from './resource-limit-tracker.js'
export { extractUsageFromResult } from './usage-extractor.js'
export type { ExtractedUsage } from './usage-extractor.js'
export { TraceRecorder, verifyChain } from './trace-recorder.js'
export type { TraceEntry, SignedTraceEntry, VerifyChainResult } from './trace-recorder.js'

export type { FuzeService, ToolRegistration, ToolConfig } from './services/index.js'
export { createService, ApiService, DaemonService, NoopService } from './services/index.js'

export { guardMethod } from './guard-method.js'
export { guarded } from './guarded.js'
export { guardAll } from './guard-all.js'

export function configure(config: FuzeConfig): void {
  applyConfigure(config)
}

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

  fireAndForget(service.sendRunStart(runId, fn.name || 'anonymous', {}))

  const guardFn = createGuardWrapper(resolved, context)
  return guardFn(fn, options)
}

export function createRun(agentId = 'default', options?: GuardOptions): RunContext {
  const config = ensureConfig()
  const resolved = ConfigLoader.merge(config, options)
  const runId = randomUUID()
  const service = getOrCreateService(config)

  const context: GuardContext = {
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

export function resetConfig(): void {
  applyResetConfig()
}

export function registerTools(tools: ToolRegistration[]): void {
  const config = ensureConfig()
  const service = getOrCreateService(config)
  const projectId = config.project?.projectId ?? process.env['FUZE_PROJECT_ID'] ?? 'default'
  fireAndForget(service.registerTools(projectId, tools))
}
