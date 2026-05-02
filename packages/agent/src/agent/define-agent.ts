import type { AgentDefinition } from '../types/agent.js'
import type { GuardrailSet } from '../types/guardrail.js'
import { emptyGuardrails } from '../types/guardrail.js'
import { DEFAULT_RETENTION } from '../types/compliance.js'
import type { RetentionPolicy } from '../types/compliance.js'
import type { FuzeModel } from '../types/model.js'
import type { FuzeTool } from '../types/tool.js'

type AnyTool = FuzeTool<unknown, unknown, unknown>

type ToolRequiresEu<T> =
  [T] extends [{ readonly dataClassification: 'personal' }] ? true
  : [T] extends [{ readonly dataClassification: 'special-category' }] ? true
  : false

type AnyToolRequiresEu<Tools extends readonly unknown[]> =
  true extends { [K in keyof Tools]: ToolRequiresEu<Tools[K]> }[number] ? true : false

declare const residencyMismatch: unique symbol
type ResidencyMismatch = {
  readonly [residencyMismatch]: 'personal or special-category tool requires an EU model provider'
}

export type ResidencyConstraint<M extends FuzeModel, Tools extends readonly unknown[]> =
  AnyToolRequiresEu<Tools> extends true
    ? (M['residency'] extends 'eu' ? unknown : ResidencyMismatch)
    : unknown

export interface DefineAgentInput<TDeps, TOut> extends Omit<AgentDefinition<TDeps, TOut>, 'guardrails' | 'retention'> {
  readonly guardrails?: Partial<GuardrailSet<TDeps>>
  readonly retention?: RetentionPolicy
}

type WithResidency<TDeps, TOut, M extends FuzeModel, Tools extends readonly AnyTool[]> =
  Omit<DefineAgentInput<TDeps, TOut>, 'model' | 'tools'> & {
    readonly model: M
    readonly tools: Tools
  } & ResidencyConstraint<M, Tools>

export const defineAgent = <
  TDeps,
  TOut,
  M extends FuzeModel = FuzeModel,
  Tools extends readonly AnyTool[] = readonly AnyTool[],
>(
  spec: WithResidency<TDeps, TOut, M, Tools>,
): AgentDefinition<TDeps, TOut> => {
  const empty = emptyGuardrails<TDeps>()
  const guardrails: GuardrailSet<TDeps> = {
    input: spec.guardrails?.input ?? empty.input,
    toolResult: spec.guardrails?.toolResult ?? empty.toolResult,
    output: spec.guardrails?.output ?? empty.output,
  }
  return {
    purpose: spec.purpose,
    lawfulBasis: spec.lawfulBasis,
    annexIIIDomain: spec.annexIIIDomain,
    producesArt22Decision: spec.producesArt22Decision,
    ...(spec.art14OversightPlan ? { art14OversightPlan: spec.art14OversightPlan } : {}),
    model: spec.model,
    tools: spec.tools,
    guardrails,
    ...(spec.memory ? { memory: spec.memory } : {}),
    output: spec.output,
    maxSteps: spec.maxSteps,
    retryBudget: spec.retryBudget,
    retention: spec.retention ?? DEFAULT_RETENTION,
    deps: spec.deps,
  }
}
