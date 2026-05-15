import { createHash, randomUUID } from 'node:crypto'
import type { CaptureMode, SpanRole, StepContent, StepRecord } from './types.js'
import { FuzeError } from './errors.js'
import { getCurrentRunContext, runWithContext } from './run-context.js'

export interface SpanOptions {
  role: SpanRole
  capture?: CaptureMode
  content?: StepContent
  attrs?: Record<string, unknown>
  toolName?: string
}

export interface TracedOptions {
  role: SpanRole
  capture?: CaptureMode
  attrs?: Record<string, unknown>
  toolName?: string
  captureArgs?: boolean
  captureResult?: boolean
}

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

function hashFor(content: StepContent | undefined, toolName: string, role: SpanRole): string {
  const seed: unknown = content !== undefined && content !== null
    ? content
    : { role, tool_name: toolName }
  const hash = createHash('sha256')
  let serialized: string
  try {
    serialized = canonicalStringify(seed)
  } catch {
    serialized = `${toolName}:${role}`
  }
  hash.update(serialized)
  return hash.digest('hex').slice(0, 16)
}

function hashArgs(args: unknown[]): string {
  const hash = createHash('sha256')
  let serialized: string
  try {
    serialized = canonicalStringify({ args, kwargs: {} })
  } catch {
    serialized = '[unserializable]'
  }
  hash.update(serialized)
  return hash.digest('hex').slice(0, 16)
}

function resolveContent(
  capture: CaptureMode,
  content: StepContent | undefined,
  ctx: ReturnType<typeof getCurrentRunContext>,
): StepContent | undefined {
  if (capture === 'hash' || content === undefined) return undefined
  if (capture === 'full+redact') {
    const redactor = ctx?.config.redactor
    if (!redactor) {
      throw new FuzeError('full+redact requires a configured redactor')
    }
    return redactor.redactContent(content)
  }
  return content
}

export async function span(opts: SpanOptions): Promise<void> {
  const ctx = getCurrentRunContext()
  if (!ctx) {
    throw new FuzeError('span() called outside fuze.run()')
  }

  const capture: CaptureMode = opts.capture ?? 'hash'
  const toolName = opts.toolName ?? opts.role
  const resolvedContent = resolveContent(capture, opts.content, ctx)
  const argsHash = hashFor(resolvedContent ?? opts.content, toolName, opts.role)

  const stepId = randomUUID()
  const now = new Date().toISOString()
  const stepNumber = ++ctx.guardContext.stepNumber

  const record: StepRecord = {
    stepId,
    runId: ctx.runId,
    stepNumber,
    startedAt: now,
    endedAt: now,
    toolName,
    argsHash,
    hasSideEffect: false,
    tokensIn: 0,
    tokensOut: 0,
    latencyMs: 0,
    role: opts.role,
    capture,
  }

  if (ctx.parentStepId) record.parentStepId = ctx.parentStepId
  if (resolvedContent !== undefined) record.content = resolvedContent
  if (opts.attrs !== undefined) record.attrs = opts.attrs

  ctx.traceRecorder.recordStep(record)
}

export function traced<T extends (...args: any[]) => any>(fn: T, opts: TracedOptions): T {
  const role = opts.role
  const capture: CaptureMode = opts.capture ?? 'hash'
  const toolName = opts.toolName ?? fn.name ?? role
  const captureArgs = opts.captureArgs ?? capture !== 'hash'
  const captureResult = opts.captureResult ?? capture !== 'hash'

  const wrapped = function (this: unknown, ...args: unknown[]): unknown {
    const ctx = getCurrentRunContext()
    if (!ctx) {
      throw new FuzeError('traced() called outside fuze.run()')
    }

    const stepId = randomUUID()
    const parentStepId = ctx.parentStepId
    const startedAt = new Date().toISOString()
    const startMs = Date.now()
    const stepNumber = ++ctx.guardContext.stepNumber

    const buildContent = (result?: unknown): StepContent | undefined => {
      if (capture === 'hash') return undefined
      const c: StepContent = {
        kind: 'tool_call',
        args: captureArgs ? args : undefined,
      }
      if (result !== undefined && captureResult) {
        c.result = result
      }
      return c
    }

    const finalize = (result: unknown, error: string | undefined): void => {
      const endedAt = new Date().toISOString()
      const latencyMs = Date.now() - startMs
      const rawContent = buildContent(error ? undefined : result)
      const resolvedContent = resolveContent(capture, rawContent, ctx)
      const argsHash = hashArgs(args)

      const record: StepRecord = {
        stepId,
        runId: ctx.runId,
        stepNumber,
        startedAt,
        endedAt,
        toolName,
        argsHash,
        hasSideEffect: false,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs,
        role,
        capture,
      }

      if (parentStepId) record.parentStepId = parentStepId
      if (resolvedContent !== undefined) record.content = resolvedContent
      if (opts.attrs !== undefined) record.attrs = opts.attrs
      if (error !== undefined) record.error = error

      ctx.traceRecorder.recordStep(record)
    }

    const nestedCtx = { ...ctx, parentStepId: stepId }

    let invocation: unknown
    try {
      invocation = runWithContext(nestedCtx, () => fn.apply(this, args))
    } catch (err) {
      finalize(undefined, err instanceof Error ? err.message : String(err))
      throw err
    }

    if (invocation && typeof (invocation as Promise<unknown>).then === 'function') {
      return (invocation as Promise<unknown>).then(
        (result) => {
          finalize(result, undefined)
          return result
        },
        (err) => {
          finalize(undefined, err instanceof Error ? err.message : String(err))
          throw err
        },
      )
    }

    finalize(invocation, undefined)
    return invocation
  }

  Object.defineProperty(wrapped, 'name', { value: toolName, configurable: true })
  return wrapped as unknown as T
}
