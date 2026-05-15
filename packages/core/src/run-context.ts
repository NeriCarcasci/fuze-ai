import { AsyncLocalStorage } from 'node:async_hooks'
import type { FuzeConfig } from './types.js'
import type { GuardContext } from './guard.js'

export interface ActiveRunContext {
  runId: string
  sessionId?: string
  userId?: string
  tenant?: string
  parentStepId?: string
  traceRecorder: GuardContext['traceRecorder']
  service: GuardContext['service']
  config: FuzeConfig
  guardContext: GuardContext
}

const storage = new AsyncLocalStorage<ActiveRunContext>()

export function getCurrentRunContext(): ActiveRunContext | undefined {
  return storage.getStore()
}

export function runWithContext<T>(ctx: ActiveRunContext, fn: () => T): T {
  return storage.run(ctx, fn)
}
