import type { Evaluator, EvaluationResult } from '../types.js'

export interface EvidenceContainsOptions {
  readonly spans?: readonly string[]
  readonly attrs?: Readonly<Record<string, unknown>>
}

export const evidenceContainsEvaluator = <TIn, TOut>(
  opts: EvidenceContainsOptions,
): Evaluator<TIn, TOut> => ({
  name: 'evidenceContains',
  async evaluate(ctx): Promise<EvaluationResult> {
    const missingSpans: string[] = []
    if (opts.spans) {
      const seen = new Set(ctx.records.map((r) => r.payload.span))
      for (const s of opts.spans) {
        if (!seen.has(s)) missingSpans.push(s)
      }
    }

    const missingAttrs: { key: string; expected: unknown }[] = []
    if (opts.attrs) {
      for (const k of Object.keys(opts.attrs)) {
        const expected = opts.attrs[k]
        const found = ctx.records.some((r) => {
          const v = r.payload.attrs[k]
          if (v === undefined) return false
          return JSON.stringify(v) === JSON.stringify(expected)
        })
        if (!found) missingAttrs.push({ key: k, expected })
      }
    }

    const passed = missingSpans.length === 0 && missingAttrs.length === 0
    return passed
      ? { passed: true, score: 1 }
      : {
          passed: false,
          score: 0,
          reason: 'evidence missing expected spans or attrs',
          evidence: { missingSpans, missingAttrs },
        }
  },
})
