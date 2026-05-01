import type { Evaluator, EvaluationResult } from '../types.js'

export interface TokenBudgetEvaluatorOptions {
  readonly maxTokens: number
}

export const tokenBudgetEvaluator = <TIn, TOut>(
  opts: TokenBudgetEvaluatorOptions,
): Evaluator<TIn, TOut> => ({
  name: 'tokenBudget',
  async evaluate(ctx): Promise<EvaluationResult> {
    let tokensIn = 0
    let tokensOut = 0
    for (const r of ctx.records) {
      const attrs = r.payload.attrs
      const tin = attrs['gen_ai.usage.input_tokens']
      const tout = attrs['gen_ai.usage.output_tokens']
      if (typeof tin === 'number') tokensIn += tin
      if (typeof tout === 'number') tokensOut += tout
    }
    const total = tokensIn + tokensOut
    const passed = total <= opts.maxTokens
    const score = passed ? 1 : Math.max(0, opts.maxTokens / Math.max(total, 1))
    return passed
      ? { passed: true, score: 1, evidence: { tokensIn, tokensOut, total, maxTokens: opts.maxTokens } }
      : {
          passed: false,
          score,
          reason: `total tokens ${total} exceeded budget ${opts.maxTokens}`,
          evidence: { tokensIn, tokensOut, total, maxTokens: opts.maxTokens },
        }
  },
})
