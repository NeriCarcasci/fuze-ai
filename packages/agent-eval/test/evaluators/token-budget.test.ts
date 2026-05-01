import { describe, it, expect } from 'vitest'
import { tokenBudgetEvaluator } from '../../src/evaluators/token-budget.js'
import type { ChainedRecord, EvidenceSpan } from '@fuze-ai/agent'

const mkSpan = (tin: number, tout: number): ChainedRecord<EvidenceSpan> =>
  ({
    sequence: 0,
    prevHash: '0',
    hash: '0',
    payload: {
      span: 'model.generate',
      role: 'model',
      runId: 'r' as unknown as EvidenceSpan['runId'],
      stepId: 's' as unknown as EvidenceSpan['stepId'],
      startedAt: '2025-01-01T00:00:00.000Z',
      endedAt: '2025-01-01T00:00:00.100Z',
      common: {} as EvidenceSpan['common'],
      attrs: { 'gen_ai.usage.input_tokens': tin, 'gen_ai.usage.output_tokens': tout },
    },
  }) as ChainedRecord<EvidenceSpan>

const baseCase = { id: 'c', input: null }

describe('tokenBudgetEvaluator', () => {
  it('passes within budget', async () => {
    const ev = tokenBudgetEvaluator({ maxTokens: 100 })
    const r = await ev.evaluate({
      case: baseCase,
      actualOutput: undefined,
      status: 'completed',
      records: [mkSpan(20, 10)],
    })
    expect(r.passed).toBe(true)
  })

  it('fails over budget', async () => {
    const ev = tokenBudgetEvaluator({ maxTokens: 10 })
    const r = await ev.evaluate({
      case: baseCase,
      actualOutput: undefined,
      status: 'completed',
      records: [mkSpan(20, 10)],
    })
    expect(r.passed).toBe(false)
  })
})
