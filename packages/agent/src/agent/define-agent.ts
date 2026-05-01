import type { AgentDefinition } from '../types/agent.js'
import type { GuardrailSet } from '../types/guardrail.js'
import { emptyGuardrails } from '../types/guardrail.js'
import { DEFAULT_RETENTION } from '../types/compliance.js'
import type { RetentionPolicy } from '../types/compliance.js'

export interface DefineAgentInput<TDeps, TOut> extends Omit<AgentDefinition<TDeps, TOut>, 'guardrails' | 'retention'> {
  readonly guardrails?: Partial<GuardrailSet<TDeps>>
  readonly retention?: RetentionPolicy
}

export const defineAgent = <TDeps, TOut>(
  spec: DefineAgentInput<TDeps, TOut>,
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
