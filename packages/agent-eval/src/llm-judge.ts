import type { FuzeModel } from '@fuze-ai/agent'
import type { Evaluator, EvaluationResult } from './types.js'

export interface LlmJudgeOptions {
  readonly model: FuzeModel
  readonly rubric: string
  readonly threshold?: number
  readonly name?: string
}

interface JudgeVerdict {
  readonly score: number
  readonly reason: string
}

const parseVerdict = (raw: string): JudgeVerdict | null => {
  const trimmed = raw.trim()
  try {
    const parsed = JSON.parse(trimmed) as { score?: unknown; reason?: unknown }
    if (typeof parsed.score === 'number' && parsed.score >= 0 && parsed.score <= 1) {
      const reason = typeof parsed.reason === 'string' ? parsed.reason : ''
      return { score: parsed.score, reason }
    }
  } catch {
    // fall through
  }
  return null
}

export class LlmAsJudgeEvaluator<TIn, TOut> implements Evaluator<TIn, TOut> {
  readonly name: string
  private readonly model: FuzeModel
  private readonly rubric: string
  private readonly threshold: number

  constructor(opts: LlmJudgeOptions) {
    this.model = opts.model
    this.rubric = opts.rubric
    this.threshold = opts.threshold ?? 0.7
    this.name = opts.name ?? 'llmJudge'
  }

  async evaluate(ctx: {
    readonly case: { readonly input: TIn; readonly expectedOutput?: TOut }
    readonly actualOutput: TOut | undefined
  }): Promise<EvaluationResult> {
    const userPayload = JSON.stringify({
      rubric: this.rubric,
      input: ctx.case.input,
      expectedOutput: ctx.case.expectedOutput,
      actualOutput: ctx.actualOutput,
    })
    const step = await this.model.generate({
      messages: [
        {
          role: 'system',
          content:
            'You are an evaluator. Reply with JSON only: {"score": <number 0..1>, "reason": "<short>"}.',
        },
        { role: 'user', content: userPayload },
      ],
      tools: [],
    })
    const verdict = parseVerdict(step.content)
    if (!verdict) {
      return {
        passed: false,
        score: 0,
        reason: `judge model returned non-conformant output: ${step.content.slice(0, 120)}`,
      }
    }
    return {
      passed: verdict.score >= this.threshold,
      score: verdict.score,
      reason: verdict.reason,
      evidence: { rubric: this.rubric, threshold: this.threshold },
    }
  }
}
