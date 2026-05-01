import type {
  PolicyDecision,
  PolicyEngine,
  PolicyEvaluateInput,
  PolicyEffect,
} from '@fuze-ai/agent'
import type { ResourcePolicy, Rule, RuleEffect } from './types.js'
import { parsePolicy } from './yaml.js'
import { evaluateCel, type CelBindings } from './cel-mini.js'

const INVOKE_ACTION = 'invoke'

const mapEffect = (e: RuleEffect): PolicyEffect => {
  switch (e) {
    case 'EFFECT_ALLOW':
    case 'allow':
      return 'allow'
    case 'EFFECT_DENY':
    case 'deny':
      return 'deny'
    case 'EFFECT_REQUIRES_APPROVAL':
    case 'requires-approval':
      return 'requires-approval'
  }
}

const buildBindings = (input: PolicyEvaluateInput): CelBindings => {
  const args = (typeof input.args === 'object' && input.args !== null
    ? (input.args as Record<string, unknown>)
    : {}) as Record<string, unknown>
  const rAttr: Record<string, unknown> = {
    ...args,
    name: input.tool.name,
    classification: input.tool.dataClassification,
  }
  const pAttr: Record<string, unknown> = {
    tenant: input.ctx.tenant,
    principal: input.ctx.principal,
  }
  return { R: { attr: rAttr }, P: { attr: pAttr } }
}

const ruleId = (resource: string, rule: Rule, idx: number): string =>
  rule.id ?? `${resource}#rule-${idx}`

export class CerbosCompatPolicyEngine implements PolicyEngine {
  private readonly policies: readonly ResourcePolicy[]

  constructor(policies: readonly string[]) {
    this.policies = policies.map((p) => parsePolicy(p))
  }

  async evaluate(input: PolicyEvaluateInput): Promise<PolicyDecision> {
    const toolName = input.tool.name
    const matchingPolicies = this.policies.filter(
      (p) =>
        p.resourcePolicy.resource === toolName || p.resourcePolicy.resource === '*',
    )

    for (const policy of matchingPolicies) {
      const bindings = buildBindings(input)
      const rules = policy.resourcePolicy.rules
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i] as Rule
        if (!rule.actions.includes(INVOKE_ACTION) && !rule.actions.includes('*')) {
          continue
        }
        if (rule.condition !== undefined) {
          if (!evaluateCel(rule.condition.match.expr, bindings)) continue
        }
        const id = ruleId(policy.resourcePolicy.resource, rule, i)
        return {
          effect: mapEffect(rule.effect),
          policyId: id,
          reason: `matched ${id}`,
        }
      }
    }

    return {
      effect: 'deny',
      policyId: 'fuze.default.deny',
      reason: 'no matching policy rule (default-deny)',
    }
  }
}
