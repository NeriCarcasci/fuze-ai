import { describe, it, expect } from 'vitest'
import { policyDecisionEvaluator } from '../../src/evaluators/policy-decision.js'
import type { ChainedRecord, EvidenceSpan } from '@fuze-ai/agent'

const mkPolicySpan = (toolName: string, effect: string): ChainedRecord<EvidenceSpan> =>
  ({
    sequence: 0,
    prevHash: '0',
    hash: '0',
    payload: {
      span: 'policy.evaluate',
      role: 'policy',
      runId: 'r' as unknown as EvidenceSpan['runId'],
      stepId: 's' as unknown as EvidenceSpan['stepId'],
      startedAt: '2025-01-01T00:00:00.000Z',
      endedAt: '2025-01-01T00:00:00.100Z',
      common: {} as EvidenceSpan['common'],
      attrs: { 'fuze.policy.tool': toolName, 'fuze.policy.effect': effect },
    },
  }) as ChainedRecord<EvidenceSpan>

const baseCase = { id: 'c', input: null }

describe('policyDecisionEvaluator', () => {
  it('passes when expected effect matches', async () => {
    const ev = policyDecisionEvaluator({ expectedEffect: 'allow' })
    const r = await ev.evaluate({
      case: baseCase,
      actualOutput: undefined,
      status: 'completed',
      records: [mkPolicySpan('echo', 'allow')],
    })
    expect(r.passed).toBe(true)
  })

  it('fails when effect does not match', async () => {
    const ev = policyDecisionEvaluator({ expectedEffect: 'requires-approval' })
    const r = await ev.evaluate({
      case: baseCase,
      actualOutput: undefined,
      status: 'completed',
      records: [mkPolicySpan('echo', 'allow')],
    })
    expect(r.passed).toBe(false)
  })

  it('filters by tool name', async () => {
    const ev = policyDecisionEvaluator({ expectedEffect: 'requires-approval', toolName: 'transfer' })
    const r = await ev.evaluate({
      case: baseCase,
      actualOutput: undefined,
      status: 'completed',
      records: [mkPolicySpan('echo', 'allow'), mkPolicySpan('transfer', 'requires-approval')],
    })
    expect(r.passed).toBe(true)
  })
})
