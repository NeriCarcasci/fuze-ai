import type { Evaluator, EvaluationResult } from '../types.js'

export interface PolicyDecisionOptions {
  readonly expectedEffect: 'allow' | 'deny' | 'requires-approval'
  readonly toolName?: string
}

export const policyDecisionEvaluator = <TIn, TOut>(
  opts: PolicyDecisionOptions,
): Evaluator<TIn, TOut> => ({
  name: 'policyDecision',
  async evaluate(ctx): Promise<EvaluationResult> {
    const policySpans = ctx.records.filter((r) => r.payload.span === 'policy.evaluate')
    const filtered = opts.toolName
      ? policySpans.filter((r) => r.payload.attrs['fuze.policy.tool'] === opts.toolName)
      : policySpans
    if (filtered.length === 0) {
      return {
        passed: false,
        score: 0,
        reason: opts.toolName
          ? `no policy.evaluate span for tool ${opts.toolName}`
          : 'no policy.evaluate spans recorded',
      }
    }
    const effects = filtered.map((r) => String(r.payload.attrs['fuze.policy.effect']))
    const matched = effects.every((e) => e === opts.expectedEffect)
    return matched
      ? { passed: true, score: 1, evidence: { effects } }
      : {
          passed: false,
          score: 0,
          reason: `expected effect ${opts.expectedEffect}, saw ${effects.join(',')}`,
          evidence: { effects, expected: opts.expectedEffect },
        }
  },
})
