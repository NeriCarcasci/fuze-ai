import { describe, it, expect } from 'vitest'
import { latencyEvaluator } from '../../src/evaluators/latency.js'
import type { ChainedRecord, EvidenceSpan } from '@fuze-ai/agent'

const mkRecord = (start: string, end: string): ChainedRecord<EvidenceSpan> =>
  ({
    sequence: 0,
    prevHash: '0',
    hash: '0',
    payload: {
      span: 'x',
      role: 'agent',
      runId: 'r' as unknown as EvidenceSpan['runId'],
      stepId: 's' as unknown as EvidenceSpan['stepId'],
      startedAt: start,
      endedAt: end,
      common: {} as EvidenceSpan['common'],
      attrs: {},
    },
  }) as ChainedRecord<EvidenceSpan>

const baseCase = { id: 'c', input: null }

describe('latencyEvaluator', () => {
  it('passes when total span duration is under budget', async () => {
    const ev = latencyEvaluator({ maxMs: 500 })
    const records = [
      mkRecord('2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.100Z'),
      mkRecord('2025-01-01T00:00:00.100Z', '2025-01-01T00:00:00.300Z'),
    ]
    const r = await ev.evaluate({ case: baseCase, actualOutput: undefined, status: 'completed', records })
    expect(r.passed).toBe(true)
  })

  it('fails when over budget', async () => {
    const ev = latencyEvaluator({ maxMs: 100 })
    const records = [mkRecord('2025-01-01T00:00:00.000Z', '2025-01-01T00:00:00.500Z')]
    const r = await ev.evaluate({ case: baseCase, actualOutput: undefined, status: 'completed', records })
    expect(r.passed).toBe(false)
    expect(r.score).toBeLessThan(1)
  })
})
