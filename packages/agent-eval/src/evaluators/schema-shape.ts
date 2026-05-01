import type { ZodType } from 'zod'
import type { Evaluator, EvaluationResult } from '../types.js'

export const schemaShapeEvaluator = <TIn, TOut>(
  schema: ZodType<unknown>,
): Evaluator<TIn, TOut> => ({
  name: 'schemaShape',
  async evaluate(ctx): Promise<EvaluationResult> {
    if (ctx.actualOutput === undefined) {
      return { passed: false, score: 0, reason: 'no actualOutput to validate' }
    }
    const parsed = schema.safeParse(ctx.actualOutput)
    if (parsed.success) return { passed: true, score: 1 }
    return {
      passed: false,
      score: 0,
      reason: 'output failed schema',
      evidence: { issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })) },
    }
  },
})
