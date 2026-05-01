import { randomUUID } from 'node:crypto'
import { ZodType } from 'zod'
import type {
  AgentDefinition,
  AgentRunResult,
  AgentRunStatus,
} from '../types/agent.js'
import type {
  SuspendedRun,
  OversightDecision,
  ResumeTokenStore,
} from '../types/oversight.js'
import type { Ed25519Verifier } from '../types/signing.js'
import type { ChainedRecord } from '../evidence/hash-chain.js'
import { EvidenceEmitter, type EvidenceSpan } from '../evidence/emitter.js'
import type { PolicyEngine } from '../types/policy.js'
import type { ModelMessage } from '../types/model.js'
import type { TenantId, PrincipalId } from '../types/brand.js'
import { makeRunId, makeStepId } from '../types/brand.js'
import type { SubjectRef } from '../types/compliance.js'
import type { SecretsHandle } from '../types/secrets.js'
import { evaluateApproval } from './approval.js'
import { executeApprovedTool } from './execute-approved.js'
import type { SnapshotSink } from './loop.js'
import { computeDefinitionFingerprint, DefinitionFingerprintMismatchError } from './fingerprint.js'
import type { ToolCallRequest } from '../types/model.js'
import type { AnyFuzeTool } from '../types/tool.js'
import { isRetryable } from '../types/result.js'
import type { Ctx, AttrValue } from '../types/ctx.js'
import { buildCtx } from '../types/ctx.js'
import type { ZodType as ZodTypeAlias } from 'zod'

export interface ResumeRunDeps<TDeps, TOut> {
  readonly definition: AgentDefinition<TDeps, TOut>
  readonly policy: PolicyEngine
  readonly verifier: Ed25519Verifier
  readonly nonceStore: ResumeTokenStore
  readonly evidenceSink: (record: ChainedRecord<EvidenceSpan>) => void | Promise<void>
  readonly captureFullContent?: boolean
  readonly snapshotSink?: SnapshotSink
  readonly clock?: () => Date
}

export interface ResumeRunInput {
  readonly suspended: SuspendedRun
  readonly decision: OversightDecision
  readonly tenant: TenantId
  readonly principal: PrincipalId
  readonly subjectRef?: SubjectRef
  readonly secrets: SecretsHandle
  readonly priorHistory: readonly ModelMessage[]
  readonly allowDefinitionDrift?: boolean
}

export const resumeRun = async <TDeps, TOut>(
  deps: ResumeRunDeps<TDeps, TOut>,
  input: ResumeRunInput,
): Promise<AgentRunResult<TOut>> => {
  const def = deps.definition
  const clock = deps.clock ?? (() => new Date())
  const runId = makeRunId(input.suspended.runId)

  const currentFingerprint = computeDefinitionFingerprint(def)
  if (
    input.suspended.definitionFingerprint &&
    input.suspended.definitionFingerprint !== currentFingerprint &&
    !input.allowDefinitionDrift
  ) {
    throw new DefinitionFingerprintMismatchError(
      input.suspended.definitionFingerprint,
      currentFingerprint,
    )
  }

  const emitter = new EvidenceEmitter({
    tenant: input.tenant,
    principal: input.principal,
    runId,
    ...(input.subjectRef === undefined ? {} : { subjectRef: input.subjectRef }),
    lawfulBasis: def.lawfulBasis,
    annexIIIDomain: def.annexIIIDomain,
    producesArt22Decision: def.producesArt22Decision,
    retention: def.retention,
    captureFullContent: deps.captureFullContent ?? false,
    sink: deps.evidenceSink,
    resumeFrom: {
      chainHead: input.suspended.chainHeadAtSuspend,
      nextSequence: input.suspended.suspendedAtSequence + 1,
    },
  })

  const approval = await evaluateApproval(
    { verifier: deps.verifier, nonceStore: deps.nonceStore, emitter, clock },
    {
      suspended: input.suspended,
      token: input.suspended.resumeToken,
      decision: input.decision,
    },
  )

  if (!approval.continued) {
    const status: AgentRunStatus =
      input.decision.action === 'reject'
        ? 'tripwire'
        : input.decision.action === 'halt'
          ? 'tripwire'
          : 'completed'
    return {
      status,
      reason: `decision=${input.decision.action}`,
      runId,
      steps: 0,
      evidenceHashChainHead: emitter.head(),
    }
  }

  const tool = def.tools.find((t) => t.name === input.suspended.toolName)
  if (!tool) {
    return {
      status: 'error',
      reason: `suspended tool not found in definition: ${input.suspended.toolName}`,
      runId,
      steps: 0,
      evidenceHashChainHead: emitter.head(),
    }
  }

  const execution = await executeApprovedTool(
    {
      tool,
      emitter,
      tenant: input.tenant,
      principal: input.principal,
      ...(input.subjectRef === undefined ? {} : { subjectRef: input.subjectRef }),
      secrets: input.secrets,
      clock,
    },
    { suspended: input.suspended, decision: input.decision },
  )

  if (!execution.executed) {
    return {
      status: 'error',
      reason: execution.error ?? execution.reason ?? 'approved tool failed to execute',
      runId,
      steps: 0,
      evidenceHashChainHead: emitter.head(),
    }
  }

  const history: ModelMessage[] = [...input.priorHistory]
  history.push({
    role: 'tool',
    content: typeof execution.output === 'string' ? execution.output : JSON.stringify(execution.output),
    name: input.suspended.toolName,
    toolCallId: `approved-${randomUUID()}`,
  })

  const toolsByName = new Map<string, AnyFuzeTool>()
  for (const t of def.tools) toolsByName.set(t.name, t)

  let stepsUsed = 0
  let finalText: string | null = null

  while (stepsUsed < def.maxSteps) {
    stepsUsed++
    const modelStarted = clock().toISOString()
    const step = await def.model.generate({ messages: history, tools: def.tools })
    emitter.emit({
      span: 'model.generate',
      role: 'model',
      stepId: makeStepId(randomUUID()),
      startedAt: modelStarted,
      endedAt: clock().toISOString(),
      attrs: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': def.model.providerName,
        'gen_ai.request.model': def.model.modelName,
        'gen_ai.usage.input_tokens': step.tokensIn,
        'gen_ai.usage.output_tokens': step.tokensOut,
        'gen_ai.response.finish_reasons': [step.finishReason],
        'fuze.continuation': true,
      },
      content: { messages: history, response: { content: step.content, toolCalls: step.toolCalls } },
    })

    if (step.toolCalls.length === 0) {
      finalText = step.content
      break
    }

    history.push({ role: 'assistant', content: step.content })
    let halted: { reason: string; status: 'error' | 'tripwire' | 'policy-denied' } | null = null
    for (const call of step.toolCalls) {
      const dispatchResult = await dispatchContinuationTool(
        deps,
        input,
        emitter,
        toolsByName,
        call,
        clock,
      )
      if (dispatchResult.kind === 'output') {
        history.push({
          role: 'tool',
          content: typeof dispatchResult.output === 'string' ? dispatchResult.output : JSON.stringify(dispatchResult.output),
          name: call.name,
          toolCallId: call.id,
        })
      } else {
        halted = { reason: dispatchResult.reason, status: dispatchResult.status }
        break
      }
    }
    if (halted) {
      return {
        status: halted.status,
        reason: halted.reason,
        runId,
        steps: stepsUsed,
        evidenceHashChainHead: emitter.head(),
      }
    }
  }

  if (finalText === null) {
    return {
      status: 'budget-exceeded',
      reason: `maxSteps=${def.maxSteps} reached during continuation`,
      runId,
      steps: stepsUsed,
      evidenceHashChainHead: emitter.head(),
    }
  }

  let parsedOutput: TOut
  try {
    const trimmed = finalText.trim()
    const value = trimmed.length === 0 ? {} : tryParseJson(trimmed)
    parsedOutput = (def.output as ZodType<TOut>).parse(value)
  } catch (e) {
    return {
      status: 'error',
      reason: `output schema failed on continuation: ${(e as Error).message}`,
      runId,
      steps: stepsUsed,
      evidenceHashChainHead: emitter.head(),
    }
  }

  if (deps.snapshotSink) {
    await Promise.resolve(
      deps.snapshotSink.save({
        runId,
        stepsUsed,
        retriesUsed: 0,
        chainHead: emitter.head(),
        lastSequence: emitter.records().length - 1 + input.suspended.suspendedAtSequence + 1,
        history: history.slice(),
      }),
    )
  }

  return {
    status: 'completed',
    output: parsedOutput,
    runId,
    steps: stepsUsed,
    evidenceHashChainHead: emitter.head(),
  }
}

type DispatchResult =
  | { readonly kind: 'output'; readonly output: unknown }
  | { readonly kind: 'unknown-tool'; readonly reason: string; readonly status: 'error' }
  | { readonly kind: 'denied'; readonly reason: string; readonly status: 'policy-denied' }
  | { readonly kind: 'tool-error'; readonly reason: string; readonly status: 'error' }
  | { readonly kind: 'requires-approval'; readonly reason: string; readonly status: 'tripwire' }

const dispatchContinuationTool = async <TDeps, TOut>(
  deps: ResumeRunDeps<TDeps, TOut>,
  input: ResumeRunInput,
  emitter: EvidenceEmitter,
  toolsByName: ReadonlyMap<string, AnyFuzeTool>,
  call: ToolCallRequest,
  clock: () => Date,
): Promise<DispatchResult> => {
  const tool = toolsByName.get(call.name)
  if (!tool) {
    return { kind: 'unknown-tool', reason: `unknown tool ${call.name}`, status: 'error' }
  }
  const stepId = makeStepId(randomUUID())
  const startedAt = clock().toISOString()
  const collectedAttrs: Record<string, unknown> = {}
  const attribute = (k: string, v: AttrValue): void => {
    collectedAttrs[k] = v
  }
  const ctx: Ctx<unknown> = buildCtx({
    tenant: input.tenant,
    principal: input.principal,
    runId: makeRunId(input.suspended.runId),
    stepId,
    ...(input.subjectRef === undefined ? {} : { subjectRef: input.subjectRef }),
    deps: {},
    secrets: input.secrets,
    attribute,
    invoke: async () => {
      throw new Error('continuation tools cannot invoke siblings outside the loop')
    },
  })

  let policyDecision: { effect: 'allow' | 'deny' | 'requires-approval'; reason?: string; policyId?: string }
  let engineError = false
  try {
    const decision = await deps.policy.evaluate({ tool, args: call.args, ctx })
    policyDecision = decision
  } catch (e) {
    engineError = true
    policyDecision = {
      effect: 'deny',
      policyId: 'fuze.policy.engine_error',
      reason: e instanceof Error ? e.message : String(e),
    }
  }
  emitter.emit({
    span: 'policy.evaluate',
    role: 'policy',
    stepId,
    startedAt,
    endedAt: clock().toISOString(),
    attrs: {
      'fuze.policy.tool': tool.name,
      'fuze.policy.effect': policyDecision.effect,
      'fuze.policy.policy_id': policyDecision.policyId ?? 'unknown',
      'fuze.policy.reason': policyDecision.reason ?? '',
      'fuze.policy.engine_error': engineError,
      'fuze.continuation': true,
    },
  })

  if (engineError || policyDecision.effect === 'deny') {
    return {
      kind: 'denied',
      reason: policyDecision.reason ?? 'policy denied',
      status: 'policy-denied',
    }
  }
  if (policyDecision.effect === 'requires-approval') {
    return {
      kind: 'requires-approval',
      reason: 'continuation tool needs approval — re-suspend not yet supported in resume continuation',
      status: 'tripwire',
    }
  }

  let parsed: unknown
  try {
    parsed = (tool.input as ZodTypeAlias<unknown>).parse(call.args)
  } catch (e) {
    return {
      kind: 'tool-error',
      reason: `input schema rejected args: ${(e as Error).message}`,
      status: 'error',
    }
  }

  const execStarted = clock().toISOString()
  try {
    const result = await tool.run(parsed, ctx)
    if (result.ok) {
      const validated = (tool.output as ZodTypeAlias<unknown>).parse(result.value)
      emitter.emit({
        span: 'tool.execute',
        role: 'tool',
        stepId,
        startedAt: execStarted,
        endedAt: clock().toISOString(),
        attrs: {
          'gen_ai.tool.name': tool.name,
          'fuze.tool.outcome': 'value',
          'fuze.continuation': true,
          ...collectedAttrs,
        },
        content: { input: parsed, output: validated },
      })
      return { kind: 'output', output: validated }
    }
    const message = isRetryable(result.error)
      ? result.error.reason
      : result.error instanceof Error
        ? result.error.message
        : String(result.error)
    emitter.emit({
      span: 'tool.execute',
      role: 'tool',
      stepId,
      startedAt: execStarted,
      endedAt: clock().toISOString(),
      attrs: {
        'gen_ai.tool.name': tool.name,
        'fuze.tool.outcome': 'error',
        'fuze.tool.reason': message,
        'fuze.continuation': true,
        ...collectedAttrs,
      },
      content: { input: parsed, error: message },
    })
    return { kind: 'tool-error', reason: message, status: 'error' }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { kind: 'tool-error', reason: message, status: 'error' }
  }
}

const tryParseJson = (s: string): unknown => {
  const trimmed = s.trim()
  if (trimmed.length === 0) return {}
  if (
    trimmed.startsWith('{') ||
    trimmed.startsWith('[') ||
    trimmed === 'null' ||
    trimmed === 'true' ||
    trimmed === 'false'
  ) {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed
    }
  }
  return trimmed
}
