import { randomUUID } from 'node:crypto'
import type { ZodType } from 'zod'
import type { Ctx, AttrValue } from '../types/ctx.js'
import { buildCtx } from '../types/ctx.js'
import type { AnyFuzeTool } from '../types/tool.js'
import type { Result, Retryable } from '../types/result.js'
import { isRetryable } from '../types/result.js'
import type { SuspendedRun, OversightDecision } from '../types/oversight.js'
import type { EvidenceEmitter } from '../evidence/emitter.js'
import { makeStepId } from '../types/brand.js'
import type { TenantId, PrincipalId } from '../types/brand.js'
import type { SubjectRef } from '../types/compliance.js'
import type { SecretsHandle } from '../types/secrets.js'

export interface ExecuteApprovedToolDeps {
  readonly tool: AnyFuzeTool
  readonly emitter: EvidenceEmitter
  readonly tenant: TenantId
  readonly principal: PrincipalId
  readonly subjectRef?: SubjectRef
  readonly secrets: SecretsHandle
  readonly clock?: () => Date
}

export interface ExecuteApprovedToolInput {
  readonly suspended: SuspendedRun
  readonly decision: OversightDecision
}

export interface ExecuteApprovedToolOutcome {
  readonly executed: boolean
  readonly reason?: string
  readonly output?: unknown
  readonly error?: string
  readonly retryable?: boolean
  readonly emittedSpanSequence?: number
}

export const executeApprovedTool = async (
  deps: ExecuteApprovedToolDeps,
  input: ExecuteApprovedToolInput,
): Promise<ExecuteApprovedToolOutcome> => {
  if (input.decision.action === 'reject' || input.decision.action === 'halt') {
    return { executed: false, reason: `decision is ${input.decision.action}` }
  }
  if (input.suspended.toolName !== deps.tool.name) {
    return {
      executed: false,
      reason: `tool name mismatch: suspended=${input.suspended.toolName} provided=${deps.tool.name}`,
    }
  }

  const args =
    input.decision.action === 'override' && input.decision.overrideArgs
      ? input.decision.overrideArgs
      : input.suspended.toolArgs

  const clock = deps.clock ?? (() => new Date())
  const stepId = makeStepId(randomUUID())
  const startedAt = clock().toISOString()

  let parsed: unknown
  try {
    parsed = (deps.tool.input as ZodType<unknown>).parse(args)
  } catch (e) {
    const reason = `input schema rejected approved args: ${(e as Error).message}`
    deps.emitter.emit({
      span: 'tool.execute.approved',
      role: 'tool',
      stepId,
      startedAt,
      endedAt: clock().toISOString(),
      attrs: {
        'gen_ai.tool.name': deps.tool.name,
        'fuze.tool.outcome': 'error',
        'fuze.tool.reason': reason,
        'fuze.oversight.action': input.decision.action,
      },
    })
    return { executed: false, error: reason, retryable: false }
  }

  const collectedAttrs: Record<string, unknown> = {}
  const attribute = (k: string, v: AttrValue): void => {
    collectedAttrs[k] = v
  }
  const ctx: Ctx<unknown> = buildCtx({
    tenant: deps.tenant,
    principal: deps.principal,
    runId: input.suspended.runId,
    stepId,
    ...(deps.subjectRef === undefined ? {} : { subjectRef: deps.subjectRef }),
    deps: {},
    secrets: deps.secrets,
    attribute,
    invoke: async () => {
      throw new Error('approved tools cannot invoke siblings outside the loop')
    },
  })

  let outcome: ExecuteApprovedToolOutcome
  let result: Result<unknown, Retryable | Error>
  try {
    result = await deps.tool.run(parsed, ctx)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const record = deps.emitter.emit({
      span: 'tool.execute.approved',
      role: 'tool',
      stepId,
      startedAt,
      endedAt: clock().toISOString(),
      attrs: {
        'gen_ai.tool.name': deps.tool.name,
        'fuze.tool.outcome': 'error',
        'fuze.tool.reason': message,
        'fuze.oversight.action': input.decision.action,
        ...collectedAttrs,
      },
      content: { input: parsed, error: message },
    })
    return {
      executed: false,
      error: message,
      retryable: false,
      emittedSpanSequence: record.sequence,
    }
  }

  if (result.ok) {
    let validated: unknown
    try {
      validated = (deps.tool.output as ZodType<unknown>).parse(result.value)
    } catch (e) {
      const message = `output failed schema: ${(e as Error).message}`
      const record = deps.emitter.emit({
        span: 'tool.execute.approved',
        role: 'tool',
        stepId,
        startedAt,
        endedAt: clock().toISOString(),
        attrs: {
          'gen_ai.tool.name': deps.tool.name,
          'fuze.tool.outcome': 'error',
          'fuze.tool.reason': message,
          'fuze.oversight.action': input.decision.action,
          ...collectedAttrs,
        },
        content: { input: parsed, output: result.value },
      })
      return {
        executed: false,
        error: message,
        retryable: false,
        emittedSpanSequence: record.sequence,
      }
    }
    const record = deps.emitter.emit({
      span: 'tool.execute.approved',
      role: 'tool',
      stepId,
      startedAt,
      endedAt: clock().toISOString(),
      attrs: {
        'gen_ai.tool.name': deps.tool.name,
        'fuze.tool.outcome': 'value',
        'fuze.oversight.action': input.decision.action,
        'fuze.oversight.was_override': input.decision.action === 'override',
        ...collectedAttrs,
      },
      content: { input: parsed, output: validated },
    })
    outcome = {
      executed: true,
      output: validated,
      emittedSpanSequence: record.sequence,
    }
    return outcome
  }

  const err = result.error
  const message = isRetryable(err) ? err.reason : err instanceof Error ? err.message : String(err)
  const record = deps.emitter.emit({
    span: 'tool.execute.approved',
    role: 'tool',
    stepId,
    startedAt,
    endedAt: clock().toISOString(),
    attrs: {
      'gen_ai.tool.name': deps.tool.name,
      'fuze.tool.outcome': 'error',
      'fuze.tool.reason': message,
      'fuze.oversight.action': input.decision.action,
      ...collectedAttrs,
    },
    content: { input: parsed, error: message },
  })
  return {
    executed: false,
    error: message,
    retryable: isRetryable(err),
    emittedSpanSequence: record.sequence,
  }
}

