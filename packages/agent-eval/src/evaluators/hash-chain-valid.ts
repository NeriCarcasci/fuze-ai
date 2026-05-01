import { verifyChain } from '@fuze-ai/agent'
import type { Evaluator, EvaluationResult } from '../types.js'

export const hashChainValidEvaluator = <TIn, TOut>(): Evaluator<TIn, TOut> => ({
  name: 'hashChainValid',
  async evaluate(ctx): Promise<EvaluationResult> {
    const ok = verifyChain(ctx.records)
    return ok
      ? { passed: true, score: 1, evidence: { recordCount: ctx.records.length } }
      : { passed: false, score: 0, reason: 'verifyChain returned false' }
  },
})
