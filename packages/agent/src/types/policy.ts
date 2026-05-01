import type { AnyFuzeTool } from './tool.js'
import type { Ctx } from './ctx.js'

export type PolicyEffect = 'allow' | 'deny' | 'requires-approval'

export interface PolicyDecision {
  readonly effect: PolicyEffect
  readonly policyId?: string
  readonly reason?: string
}

export interface PolicyEvaluateInput {
  readonly tool: AnyFuzeTool
  readonly args: unknown
  readonly ctx: Ctx<unknown>
}

export interface PolicyEngine {
  evaluate(input: PolicyEvaluateInput): Promise<PolicyDecision>
}

export class PolicyEngineError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message)
    this.name = 'PolicyEngineError'
  }
}
