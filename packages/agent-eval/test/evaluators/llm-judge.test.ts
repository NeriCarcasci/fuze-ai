import { describe, it, expect } from 'vitest'
import { LlmAsJudgeEvaluator } from '../../src/llm-judge.js'
import type { FuzeModel, ModelStep } from '@fuze-ai/agent'

const fixedModel = (content: string): FuzeModel => ({
  providerName: 'fake',
  modelName: 'judge',
  residency: 'eu',
  generate: async () => ({
    content,
    toolCalls: [],
    finishReason: 'stop',
    tokensIn: 10,
    tokensOut: 10,
  } as ModelStep),
})

describe('LlmAsJudgeEvaluator', () => {
  it('passes when judge returns score above threshold', async () => {
    const judge = new LlmAsJudgeEvaluator({
      model: fixedModel('{"score":0.95,"reason":"matches"}'),
      rubric: 'is the answer correct',
      threshold: 0.7,
    })
    const r = await judge.evaluate({
      case: { input: 'q' as unknown as string, expectedOutput: 'a' as unknown as string },
      actualOutput: 'a' as unknown as string,
    })
    expect(r.passed).toBe(true)
    expect(r.score).toBeCloseTo(0.95)
  })

  it('fails when judge returns low score', async () => {
    const judge = new LlmAsJudgeEvaluator({
      model: fixedModel('{"score":0.2,"reason":"poor"}'),
      rubric: 'check',
    })
    const r = await judge.evaluate({
      case: { input: 'q' as unknown as string },
      actualOutput: undefined,
    })
    expect(r.passed).toBe(false)
  })

  it('fails on non-conformant judge output', async () => {
    const judge = new LlmAsJudgeEvaluator({
      model: fixedModel('not json at all'),
      rubric: 'check',
    })
    const r = await judge.evaluate({
      case: { input: 'q' as unknown as string },
      actualOutput: undefined,
    })
    expect(r.passed).toBe(false)
  })
})
