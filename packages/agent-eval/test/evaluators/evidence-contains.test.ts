import { describe, it, expect } from 'vitest'
import { evidenceContainsEvaluator } from '../../src/evaluators/evidence-contains.js'
import type { ChainedRecord, EvidenceSpan } from '@fuze-ai/agent'

const mkSpan = (name: string, attrs: Record<string, unknown> = {}): ChainedRecord<EvidenceSpan> =>
  ({
    sequence: 0,
    prevHash: '0',
    hash: '0',
    payload: {
      span: name,
      role: 'agent',
      runId: 'r' as unknown as EvidenceSpan['runId'],
      stepId: 's' as unknown as EvidenceSpan['stepId'],
      startedAt: '2025-01-01T00:00:00.000Z',
      endedAt: '2025-01-01T00:00:00.100Z',
      common: {} as EvidenceSpan['common'],
      attrs,
    },
  }) as ChainedRecord<EvidenceSpan>

const baseCase = { id: 'c', input: null }

describe('evidenceContainsEvaluator', () => {
  it('passes when all expected spans are present', async () => {
    const ev = evidenceContainsEvaluator({ spans: ['agent.invoke', 'tool.execute'] })
    const r = await ev.evaluate({
      case: baseCase,
      actualOutput: undefined,
      status: 'completed',
      records: [mkSpan('agent.invoke'), mkSpan('tool.execute')],
    })
    expect(r.passed).toBe(true)
  })

  it('fails when a span is missing', async () => {
    const ev = evidenceContainsEvaluator({ spans: ['policy.evaluate'] })
    const r = await ev.evaluate({
      case: baseCase,
      actualOutput: undefined,
      status: 'completed',
      records: [mkSpan('agent.invoke')],
    })
    expect(r.passed).toBe(false)
  })

  it('matches required attrs across spans', async () => {
    const ev = evidenceContainsEvaluator({ attrs: { 'gen_ai.tool.name': 'echo' } })
    const r = await ev.evaluate({
      case: baseCase,
      actualOutput: undefined,
      status: 'completed',
      records: [mkSpan('tool.execute', { 'gen_ai.tool.name': 'echo' })],
    })
    expect(r.passed).toBe(true)
  })
})
