import type { Ctx } from './ctx.js'

export type GuardrailPhase = 'input' | 'toolResult' | 'output'

export interface GuardrailResult {
  readonly tripwire: boolean
  readonly evidence: Readonly<Record<string, unknown>>
}

export interface FuzeGuardrail<TPayload = unknown, TDeps = unknown> {
  readonly name: string
  readonly phase: GuardrailPhase
  readonly kind: 'tripwire' | 'observe'
  evaluate(ctx: Ctx<TDeps>, payload: TPayload): Promise<GuardrailResult>
}

export interface GuardrailSet<TDeps = unknown> {
  readonly input: readonly FuzeGuardrail<unknown, TDeps>[]
  readonly toolResult: readonly FuzeGuardrail<unknown, TDeps>[]
  readonly output: readonly FuzeGuardrail<unknown, TDeps>[]
}

export const emptyGuardrails = <TDeps>(): GuardrailSet<TDeps> => ({
  input: [],
  toolResult: [],
  output: [],
})
