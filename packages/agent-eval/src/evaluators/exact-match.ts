import type { Evaluator, EvaluationResult } from '../types.js'

const deepEqual = (a: unknown, b: unknown): boolean => {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  if (typeof a !== typeof b) return false
  if (typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false
    }
    return true
  }
  const ao = a as Record<string, unknown>
  const bo = b as Record<string, unknown>
  const ak = Object.keys(ao)
  const bk = Object.keys(bo)
  if (ak.length !== bk.length) return false
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(bo, k)) return false
    if (!deepEqual(ao[k], bo[k])) return false
  }
  return true
}

export const exactMatchEvaluator = <TIn, TOut>(): Evaluator<TIn, TOut> => ({
  name: 'exactMatch',
  async evaluate(ctx): Promise<EvaluationResult> {
    if (ctx.case.expectedOutput === undefined) {
      return { passed: false, score: 0, reason: 'case has no expectedOutput' }
    }
    const ok = deepEqual(ctx.actualOutput, ctx.case.expectedOutput)
    return ok
      ? { passed: true, score: 1 }
      : {
          passed: false,
          score: 0,
          reason: 'actualOutput does not deep-equal expectedOutput',
          evidence: { actual: ctx.actualOutput as unknown, expected: ctx.case.expectedOutput as unknown },
        }
  },
})
