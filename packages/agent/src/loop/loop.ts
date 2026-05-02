import { randomUUID } from 'node:crypto'
import type { ZodType } from 'zod'
import type {
  AgentDefinition,
  AgentRunInput,
  AgentRunResult,
  AgentRunStatus,
} from '../types/agent.js'
import type { AnyFuzeTool } from '../types/tool.js'
import { requiresEuResidency } from '../types/tool.js'
import type { Ctx, AttrValue } from '../types/ctx.js'
import { buildCtx } from '../types/ctx.js'
import type {
  ModelMessage,
  ToolCallRequest,
  ModelStep,
} from '../types/model.js'
import type { GuardrailResult } from '../types/guardrail.js'
import type { PolicyEngine, PolicyDecision } from '../types/policy.js'
import { PolicyEngineError } from '../types/policy.js'
import { isRetryable } from '../types/result.js'
import { makeRunId, makeStepId } from '../types/brand.js'
import type { RunId, StepId } from '../types/brand.js'
import { EvidenceEmitter } from '../evidence/emitter.js'
import type { EvidenceSpan } from '../evidence/emitter.js'
import type { ChainedRecord } from '../evidence/hash-chain.js'
import type { Ed25519Signer } from '../types/signing.js'
import { mintResumeToken } from './suspend.js'
import type { SuspendedRun } from '../types/oversight.js'
import { computeDefinitionFingerprint } from './fingerprint.js'

export interface SnapshotSink {
  save(snapshot: {
    readonly runId: string
    readonly stepsUsed: number
    readonly retriesUsed: number
    readonly chainHead: string
    readonly lastSequence: number
    readonly history: readonly ModelMessage[]
    readonly suspendedToolName?: string
    readonly suspendedToolArgs?: Readonly<Record<string, unknown>>
  }): Promise<void> | void
}

export interface LoopDeps<TDeps, TOut> {
  readonly definition: AgentDefinition<TDeps, TOut>
  readonly policy: PolicyEngine
  readonly evidenceSink: (record: ChainedRecord<EvidenceSpan>) => void | Promise<void>
  readonly captureFullContent?: boolean
  readonly clock?: () => Date
  readonly signer?: Ed25519Signer
  readonly snapshotSink?: SnapshotSink
}

interface LoopState<TDeps, TOut> {
  readonly definition: AgentDefinition<TDeps, TOut>
  readonly policy: PolicyEngine
  readonly emitter: EvidenceEmitter
  readonly toolsByName: ReadonlyMap<string, AnyFuzeTool>
  readonly clock: () => Date
  retriesUsed: number
  stepsUsed: number
}

const validateLawfulBasisCompatibility = <TDeps, TOut>(
  def: AgentDefinition<TDeps, TOut>,
): string | null => {
  for (const tool of def.tools) {
    if (tool.dataClassification === 'public') continue
    const allowed = tool.allowedLawfulBases
    if (!allowed.includes(def.lawfulBasis)) {
      return `tool ${tool.name} does not permit lawful basis ${def.lawfulBasis}`
    }
  }
  return null
}

const validateSubjectRefRequirement = <TDeps, TOut>(
  def: AgentDefinition<TDeps, TOut>,
  input: AgentRunInput,
): string | null => {
  const needsSubject = def.tools.some((t) => t.dataClassification !== 'public')
  if (needsSubject && !input.subjectRef) {
    return 'subjectRef required: agent has tools handling non-public data'
  }
  return null
}

const validateAnnexIIIArt22 = <TDeps, TOut>(
  def: AgentDefinition<TDeps, TOut>,
): string | null => {
  if (def.annexIIIDomain !== 'none' && !def.art14OversightPlan) {
    return `annexIIIDomain=${def.annexIIIDomain} requires art14OversightPlan`
  }
  if (def.producesArt22Decision) {
    const anyTool = def.tools.find((t) => t.needsApproval !== undefined)
    if (!anyTool) {
      return 'producesArt22Decision=true requires at least one tool with needsApproval'
    }
  }
  return null
}

const validateModelResidency = <TDeps, TOut>(
  def: AgentDefinition<TDeps, TOut>,
): string | null => {
  const euOnly = def.tools.some((t) => requiresEuResidency(t))
  if (euOnly && def.model.residency !== 'eu') {
    return `model residency ${def.model.residency} incompatible with EU-only tools`
  }
  return null
}

type GuardLike<TDeps> = {
  readonly name: string
  readonly kind: 'tripwire' | 'observe'
  evaluate: (ctx: Ctx<TDeps>, payload: unknown) => Promise<GuardrailResult>
}

const runGuardrails = async <TDeps>(
  guardrails: readonly GuardLike<TDeps>[],
  ctx: Ctx<TDeps>,
  payload: unknown,
): Promise<{ tripped: boolean; failures: readonly { name: string; evidence: Readonly<Record<string, unknown>> }[] }> => {
  const failures: { name: string; evidence: Readonly<Record<string, unknown>> }[] = []
  for (const g of guardrails) {
    const result = await g.evaluate(ctx, payload)
    if (result.tripwire && g.kind === 'tripwire') {
      failures.push({ name: g.name, evidence: result.evidence })
      return { tripped: true, failures }
    }
  }
  return { tripped: false, failures }
}

const evaluatePolicySafe = async (
  policy: PolicyEngine,
  tool: AnyFuzeTool,
  args: unknown,
  ctx: Ctx<unknown>,
): Promise<{ decision: PolicyDecision; engineError: boolean }> => {
  try {
    const decision = await policy.evaluate({ tool, args, ctx })
    return { decision, engineError: false }
  } catch (e) {
    return {
      decision: {
        effect: 'deny',
        policyId: 'fuze.policy.engine_error',
        reason: e instanceof Error ? e.message : String(e),
      },
      engineError: true,
    }
  }
}

const buildToolCtx = <TDeps>(
  state: LoopState<TDeps, unknown>,
  input: AgentRunInput,
  stepId: StepId,
  attribute: (k: string, v: AttrValue) => void,
  toolRole: 'tool' | null = null,
): Ctx<TDeps> => {
  const invoke = async <TInput, TOutput>(name: string, sub: TInput): Promise<TOutput> => {
    const tool = state.toolsByName.get(name)
    if (!tool) throw new Error(`tool not found: ${name}`)
    const result = await runOneTool(state, input, tool, sub as unknown as Record<string, unknown>, stepId)
    if (result.kind === 'value') return result.value as TOutput
    throw new Error(`tool ${name} via ctx.invoke failed: ${result.reason}`)
  }
  const emitChild = toolRole === 'tool'
    ? (child: { span: string; attrs: Readonly<Record<string, unknown>>; content?: unknown }): void => {
        const now = state.clock().toISOString()
        state.emitter.emit({
          span: child.span,
          role: 'tool',
          stepId,
          startedAt: now,
          endedAt: now,
          attrs: child.attrs,
          ...(child.content !== undefined ? { content: child.content } : {}),
        })
      }
    : undefined
  return buildCtx<TDeps>({
    tenant: input.tenant,
    principal: input.principal,
    runId: makeRunId(state.emitter.head() === '0'.repeat(64) ? randomUUID() : state.emitter.head()),
    stepId,
    ...(input.subjectRef === undefined ? {} : { subjectRef: input.subjectRef }),
    deps: state.definition.deps,
    secrets: input.secrets,
    attribute,
    invoke,
    ...(emitChild ? { emitChild } : {}),
  })
}

type OneToolOutcome =
  | { readonly kind: 'value'; readonly value: unknown }
  | { readonly kind: 'denied'; readonly reason: string }
  | { readonly kind: 'tripped'; readonly reason: string }
  | { readonly kind: 'error'; readonly reason: string; readonly retryable: boolean }
  | { readonly kind: 'requires-approval'; readonly reason: string }

const buildToolContent = (input: unknown, outcome: OneToolOutcome): Record<string, unknown> => {
  if (outcome.kind === 'value') return { input, output: outcome.value }
  return { input, error: outcome.reason, errorKind: outcome.kind }
}

const runOneTool = async <TDeps, TOut>(
  state: LoopState<TDeps, TOut>,
  input: AgentRunInput,
  tool: AnyFuzeTool,
  args: unknown,
  parentStepId: StepId,
): Promise<OneToolOutcome> => {
  const stepId = makeStepId(randomUUID())
  const startedAt = state.clock().toISOString()

  const collectedAttrs: Record<string, unknown> = {}
  const attribute = (k: string, v: AttrValue): void => {
    collectedAttrs[k] = v
  }
  const ctx = buildToolCtx<TDeps>(state, input, stepId, attribute, 'tool')

  const policyResult = await evaluatePolicySafe(state.policy, tool, args, ctx as unknown as Ctx<unknown>)
  state.emitter.emit({
    span: 'policy.evaluate',
    role: 'policy',
    stepId,
    startedAt,
    endedAt: state.clock().toISOString(),
    attrs: {
      'fuze.policy.tool': tool.name,
      'fuze.policy.effect': policyResult.decision.effect,
      'fuze.policy.policy_id': policyResult.decision.policyId ?? 'unknown',
      'fuze.policy.reason': policyResult.decision.reason ?? '',
      'fuze.policy.engine_error': policyResult.engineError,
      'fuze.parent_step_id': parentStepId,
    },
  })

  if (policyResult.engineError) {
    return { kind: 'denied', reason: 'policy engine error (fail-stop)' }
  }
  if (policyResult.decision.effect === 'deny') {
    return { kind: 'denied', reason: policyResult.decision.reason ?? 'policy denied' }
  }
  if (policyResult.decision.effect === 'requires-approval') {
    return { kind: 'requires-approval', reason: policyResult.decision.reason ?? 'approval required' }
  }

  let parsed: unknown
  try {
    parsed = (tool.input as ZodType<unknown>).parse(args)
  } catch (e) {
    return { kind: 'error', reason: `input schema rejected args: ${(e as Error).message}`, retryable: false }
  }

  const execStarted = state.clock().toISOString()
  let outcome: OneToolOutcome
  try {
    const result = await tool.run(parsed, ctx as unknown as Ctx<unknown>)
    if (result.ok) {
      try {
        const validated = (tool.output as ZodType<unknown>).parse(result.value)
        outcome = { kind: 'value', value: validated }
      } catch (e) {
        outcome = { kind: 'error', reason: `tool output failed schema: ${(e as Error).message}`, retryable: false }
      }
    } else if (isRetryable(result.error)) {
      outcome = { kind: 'error', reason: result.error.reason, retryable: true }
    } else {
      const err = result.error
      outcome = { kind: 'error', reason: err instanceof Error ? err.message : String(err), retryable: false }
    }
  } catch (e) {
    outcome = { kind: 'error', reason: e instanceof Error ? e.message : String(e), retryable: false }
  }

  state.emitter.emit({
    span: 'tool.execute',
    role: 'tool',
    stepId,
    startedAt: execStarted,
    endedAt: state.clock().toISOString(),
    attrs: {
      'gen_ai.tool.name': tool.name,
      'gen_ai.tool.type': 'function',
      'fuze.data_classification': tool.dataClassification,
      'fuze.tool.outcome': outcome.kind,
      'fuze.parent_step_id': parentStepId,
      ...collectedAttrs,
    },
    content: buildToolContent(parsed, outcome),
  })

  if (outcome.kind === 'value') {
    const guardResult = await runGuardrails(
      state.definition.guardrails.toolResult,
      ctx,
      outcome.value,
    )
    state.emitter.emit({
      span: 'guardrail.toolResult',
      role: 'guardrail',
      stepId,
      startedAt: execStarted,
      endedAt: state.clock().toISOString(),
      attrs: {
        'fuze.guardrail.tripped': guardResult.tripped,
        'fuze.guardrail.failures': guardResult.failures.map((f) => f.name),
        'fuze.parent_step_id': parentStepId,
      },
    })
    if (guardResult.tripped) {
      return { kind: 'tripped', reason: `toolResult guardrail: ${guardResult.failures.map((f) => f.name).join(',')}` }
    }
  }

  return outcome
}

const buildMessages = (
  history: readonly ModelMessage[],
  userMessage: string,
  toolResults: readonly { request: ToolCallRequest; output: unknown }[],
): readonly ModelMessage[] => {
  const messages: ModelMessage[] = [...history, { role: 'user', content: userMessage }]
  for (const tr of toolResults) {
    messages.push({
      role: 'tool',
      content: typeof tr.output === 'string' ? tr.output : JSON.stringify(tr.output),
      toolCallId: tr.request.id,
      name: tr.request.name,
    })
  }
  return messages
}

export const runAgent = async <TDeps, TOut>(
  deps: LoopDeps<TDeps, TOut>,
  input: AgentRunInput,
): Promise<AgentRunResult<TOut>> => {
  const def = deps.definition
  const clock = deps.clock ?? (() => new Date())
  const runId = makeRunId(randomUUID())

  const validation =
    validateLawfulBasisCompatibility(def) ??
    validateSubjectRefRequirement(def, input) ??
    validateAnnexIIIArt22(def) ??
    validateModelResidency(def)
  if (validation) {
    return {
      status: 'error',
      reason: validation,
      runId,
      steps: 0,
      evidenceHashChainHead: '0'.repeat(64),
    }
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
  })

  const toolsByName = new Map<string, AnyFuzeTool>()
  for (const t of def.tools) toolsByName.set(t.name, t)

  const state: LoopState<TDeps, TOut> = {
    definition: def,
    policy: deps.policy,
    emitter,
    toolsByName,
    clock,
    retriesUsed: 0,
    stepsUsed: 0,
  }

  const agentStepId = makeStepId(randomUUID())
  const startedAt = clock().toISOString()
  emitter.emit({
    span: 'agent.invoke',
    role: 'agent',
    stepId: agentStepId,
    startedAt,
    endedAt: clock().toISOString(),
    attrs: {
      'gen_ai.agent.name': def.purpose,
      'gen_ai.operation.name': 'invoke_agent',
      'fuze.max_steps': def.maxSteps,
      'fuze.retry_budget': def.retryBudget,
      'fuze.model.provider': def.model.providerName,
      'fuze.model.name': def.model.modelName,
      'fuze.model.residency': def.model.residency,
    },
  })

  const inputAttribute = (_k: string, _v: AttrValue): void => undefined
  const inputCtx = buildToolCtx<TDeps>(state, input, agentStepId, inputAttribute)
  const inputGuard = await runGuardrails(def.guardrails.input, inputCtx, input.userMessage)
  emitter.emit({
    span: 'guardrail.input',
    role: 'guardrail',
    stepId: agentStepId,
    startedAt,
    endedAt: clock().toISOString(),
    attrs: {
      'fuze.guardrail.tripped': inputGuard.tripped,
      'fuze.guardrail.failures': inputGuard.failures.map((f) => f.name),
    },
  })
  if (inputGuard.tripped) {
    return finish(state, runId, 'tripwire', `input guardrail: ${inputGuard.failures.map((f) => f.name).join(',')}`)
  }

  const history: ModelMessage[] = []
  const toolResults: { request: ToolCallRequest; output: unknown }[] = []
  let finalText: string | null = null

  while (state.stepsUsed < def.maxSteps) {
    state.stepsUsed++
    const messages = buildMessages(history, input.userMessage, toolResults)
    const modelStarted = clock().toISOString()
    let step: ModelStep
    try {
      step = await def.model.generate({ messages, tools: def.tools })
    } catch (e) {
      emitter.emit({
        span: 'model.generate',
        role: 'model',
        stepId: agentStepId,
        startedAt: modelStarted,
        endedAt: clock().toISOString(),
        attrs: {
          'gen_ai.operation.name': 'chat',
          'gen_ai.provider.name': def.model.providerName,
          'gen_ai.request.model': def.model.modelName,
          'fuze.model.error': e instanceof Error ? e.message : String(e),
        },
      })
      return finish(state, runId, 'error', `model error: ${e instanceof Error ? e.message : String(e)}`)
    }

    emitter.emit({
      span: 'model.generate',
      role: 'model',
      stepId: agentStepId,
      startedAt: modelStarted,
      endedAt: clock().toISOString(),
      attrs: {
        'gen_ai.operation.name': 'chat',
        'gen_ai.provider.name': def.model.providerName,
        'gen_ai.request.model': def.model.modelName,
        'gen_ai.usage.input_tokens': step.tokensIn,
        'gen_ai.usage.output_tokens': step.tokensOut,
        'gen_ai.response.finish_reasons': [step.finishReason],
      },
      content: { messages, response: { content: step.content, toolCalls: step.toolCalls } },
    })

    toolResults.length = 0

    if (step.toolCalls.length === 0) {
      finalText = step.content
      break
    }

    let halted: { status: AgentRunStatus; reason: string; suspendedTool?: { name: string; args: Readonly<Record<string, unknown>> } } | null = null

    for (const call of step.toolCalls) {
      const tool = toolsByName.get(call.name)
      if (!tool) {
        toolResults.push({ request: call, output: { error: `unknown tool ${call.name}` } })
        continue
      }
      const outcome = await runOneTool(state, input, tool, call.args, agentStepId)
      if (outcome.kind === 'denied') {
        halted = { status: 'policy-denied', reason: outcome.reason }
        break
      }
      if (outcome.kind === 'tripped') {
        halted = { status: 'tripwire', reason: outcome.reason }
        break
      }
      if (outcome.kind === 'requires-approval') {
        halted = {
          status: 'suspended',
          reason: outcome.reason,
          suspendedTool: { name: call.name, args: call.args },
        }
        break
      }
      if (outcome.kind === 'error') {
        if (outcome.retryable && state.retriesUsed < def.retryBudget) {
          state.retriesUsed++
          toolResults.push({ request: call, output: { retry: true, reason: outcome.reason } })
          continue
        }
        halted = { status: 'error', reason: outcome.reason }
        break
      }
      toolResults.push({ request: call, output: outcome.value })
    }

    if (halted) {
      if (halted.status === 'suspended' && halted.suspendedTool) {
        if (!deps.signer) {
          return finish(state, runId, 'error', 'tool requires approval but no signer was provided to runAgent')
        }
        const chainHead = state.emitter.head()
        const sequence = state.emitter.records().length - 1
        const token = await mintResumeToken({
          runId,
          suspendedAtSequence: sequence,
          chainHeadAtSuspend: chainHead,
          signer: deps.signer,
        })
        const suspended: SuspendedRun = {
          runId,
          suspendedAtSpanId: agentStepId,
          suspendedAtSequence: sequence,
          chainHeadAtSuspend: chainHead,
          toolName: halted.suspendedTool.name,
          toolArgs: halted.suspendedTool.args,
          reason: halted.reason,
          resumeToken: token,
          definitionFingerprint: computeDefinitionFingerprint(def),
        }
        if (deps.snapshotSink) {
          await Promise.resolve(
            deps.snapshotSink.save({
              runId,
              stepsUsed: state.stepsUsed,
              retriesUsed: state.retriesUsed,
              chainHead,
              lastSequence: sequence,
              history: history.slice(),
              suspendedToolName: halted.suspendedTool.name,
              suspendedToolArgs: halted.suspendedTool.args,
            }),
          )
        }
        return {
          ...finish(state, runId, 'suspended', halted.reason),
          suspended,
        }
      }
      return finish(state, runId, halted.status, halted.reason)
    }

    history.push({ role: 'assistant', content: step.content })
    for (const tr of toolResults) {
      history.push({
        role: 'tool',
        content: typeof tr.output === 'string' ? tr.output : JSON.stringify(tr.output),
        toolCallId: tr.request.id,
        name: tr.request.name,
      })
    }

    if (deps.snapshotSink) {
      await Promise.resolve(
        deps.snapshotSink.save({
          runId,
          stepsUsed: state.stepsUsed,
          retriesUsed: state.retriesUsed,
          chainHead: state.emitter.head(),
          lastSequence: state.emitter.records().length - 1,
          history: history.slice(),
        }),
      )
    }
  }

  if (finalText === null) {
    return finish(state, runId, 'budget-exceeded', `maxSteps=${def.maxSteps} reached`)
  }

  let parsedOutput: TOut
  try {
    parsedOutput = (def.output as ZodType<TOut>).parse(finalText.trim().length === 0 ? {} : tryParseJson(finalText))
  } catch (e) {
    return finish(state, runId, 'error', `output schema failed: ${(e as Error).message}`)
  }

  const outputCtx = buildToolCtx<TDeps>(state, input, agentStepId, () => undefined)
  const outputGuard = await runGuardrails(def.guardrails.output, outputCtx, parsedOutput)
  emitter.emit({
    span: 'guardrail.output',
    role: 'guardrail',
    stepId: agentStepId,
    startedAt: clock().toISOString(),
    endedAt: clock().toISOString(),
    attrs: {
      'fuze.guardrail.tripped': outputGuard.tripped,
      'fuze.guardrail.failures': outputGuard.failures.map((f) => f.name),
    },
  })
  if (outputGuard.tripped) {
    return finish(state, runId, 'tripwire', `output guardrail: ${outputGuard.failures.map((f) => f.name).join(',')}`)
  }

  return {
    status: 'completed',
    output: parsedOutput,
    runId,
    steps: state.stepsUsed,
    evidenceHashChainHead: emitter.head(),
  }
}

const tryParseJson = (s: string): unknown => {
  const trimmed = s.trim()
  if (trimmed.length === 0) return {}
  if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed === 'null' || trimmed === 'true' || trimmed === 'false') {
    try {
      return JSON.parse(trimmed)
    } catch {
      return trimmed
    }
  }
  return trimmed
}

const finish = <TDeps, TOut>(
  state: LoopState<TDeps, TOut>,
  runId: RunId,
  status: AgentRunStatus,
  reason: string,
): AgentRunResult<TOut> => ({
  status,
  reason,
  runId,
  steps: state.stepsUsed,
  evidenceHashChainHead: state.emitter.head(),
})
