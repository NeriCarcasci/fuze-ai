import type { Evaluator, EvaluationResult } from '../types.js'

export interface LatencyEvaluatorOptions {
  readonly maxMs: number
}

const sumDurationMs = (records: readonly { readonly payload: { readonly startedAt: string; readonly endedAt: string } }[]): number => {
  let total = 0
  for (const r of records) {
    const s = Date.parse(r.payload.startedAt)
    const e = Date.parse(r.payload.endedAt)
    if (!Number.isNaN(s) && !Number.isNaN(e) && e >= s) total += e - s
  }
  return total
}

export const latencyEvaluator = <TIn, TOut>(
  opts: LatencyEvaluatorOptions,
): Evaluator<TIn, TOut> => ({
  name: 'latency',
  async evaluate(ctx): Promise<EvaluationResult> {
    const totalMs = sumDurationMs(ctx.records)
    const passed = totalMs <= opts.maxMs
    const score = passed ? 1 : Math.max(0, opts.maxMs / Math.max(totalMs, 1))
    return passed
      ? { passed: true, score: 1, evidence: { totalMs, maxMs: opts.maxMs } }
      : {
          passed: false,
          score,
          reason: `total span duration ${totalMs}ms exceeded budget ${opts.maxMs}ms`,
          evidence: { totalMs, maxMs: opts.maxMs },
        }
  },
})
