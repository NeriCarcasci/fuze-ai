import type { PolicyEngine, PolicyEvaluateInput, PolicyDecision } from '../types/policy.js'

export interface StaticRule {
  readonly id: string
  readonly toolName: string | '*'
  readonly tenant?: string
  readonly effect: 'allow' | 'deny' | 'requires-approval'
  readonly when?: (input: PolicyEvaluateInput) => boolean
}

export class StaticPolicyEngine implements PolicyEngine {
  constructor(private readonly rules: readonly StaticRule[]) {}

  async evaluate(input: PolicyEvaluateInput): Promise<PolicyDecision> {
    for (const rule of this.rules) {
      if (rule.toolName !== '*' && rule.toolName !== input.tool.name) continue
      if (rule.tenant !== undefined && rule.tenant !== input.ctx.tenant) continue
      if (rule.when && !rule.when(input)) continue
      return {
        effect: rule.effect,
        policyId: rule.id,
        reason: `matched rule ${rule.id}`,
      }
    }
    return {
      effect: 'deny',
      policyId: 'fuze.default.deny',
      reason: 'no matching policy rule (default-deny)',
    }
  }
}
