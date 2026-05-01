import { describe, expect, it } from 'vitest'
import type {
  ChainedRecord,
  EvidenceSpan,
  RetentionPolicy,
  SpanCommonAttrs,
  SpanRole,
} from '@fuze-ai/agent'
import { makePrincipalId, makeRunId, makeStepId, makeTenantId } from '@fuze-ai/agent'
import { partitionByRetention, MissingRetentionPolicyError } from '../src/retention.js'

const POLICY: RetentionPolicy = {
  id: 'test.v1',
  hashTtlDays: 30,
  fullContentTtlDays: 7,
  decisionTtlDays: 90,
}

const policies = new Map<string, RetentionPolicy>([[POLICY.id, POLICY]])

const makeCommon = (policyId = POLICY.id): SpanCommonAttrs => ({
  'fuze.tenant.id': makeTenantId('t'),
  'fuze.principal.id': makePrincipalId('p'),
  'fuze.annex_iii_domain': 'none',
  'fuze.art22_decision': false,
  'fuze.retention.policy_id': policyId,
  'fuze.lawful_basis': 'consent',
})

const makeSpan = (opts: {
  endedAt: Date
  policyId?: string
  withContentRef?: boolean
  role?: SpanRole
}): EvidenceSpan => ({
  span: 'test.span',
  role: opts.role ?? 'tool',
  runId: makeRunId('r1'),
  stepId: makeStepId('s1'),
  startedAt: opts.endedAt.toISOString(),
  endedAt: opts.endedAt.toISOString(),
  common: makeCommon(opts.policyId),
  attrs: {},
  contentHash: 'h'.repeat(64),
  ...(opts.withContentRef ? { contentRef: 'inline:{}' } : {}),
})

const makeRecord = (sequence: number, span: EvidenceSpan): ChainedRecord<EvidenceSpan> => ({
  sequence,
  prevHash: '0'.repeat(64),
  hash: 'h'.repeat(64),
  payload: span,
})

const daysAgo = (n: number, now: Date): Date => new Date(now.getTime() - n * 86_400_000)

describe('partitionByRetention', () => {
  const now = new Date('2026-01-01T00:00:00.000Z')

  it('keeps a span younger than every TTL', () => {
    const span = makeSpan({ endedAt: daysAgo(1, now), withContentRef: true })
    const out = partitionByRetention({ records: [makeRecord(0, span)], policies, now })
    expect(out.keep).toHaveLength(1)
    expect(out.expired).toHaveLength(0)
  })

  it('drops the contentRef on a span older than fullContentTtlDays but younger than hashTtlDays', () => {
    const span = makeSpan({ endedAt: daysAgo(10, now), withContentRef: true })
    const out = partitionByRetention({ records: [makeRecord(0, span)], policies, now })
    expect(out.expired).toEqual([{ record: expect.anything(), action: 'drop-content' }])
    expect(out.keep).toHaveLength(0)
  })

  it('marks a span older than hashTtlDays as hash-only', () => {
    const span = makeSpan({ endedAt: daysAgo(45, now), withContentRef: true })
    const out = partitionByRetention({ records: [makeRecord(0, span)], policies, now })
    expect(out.expired).toHaveLength(1)
    expect(out.expired[0]?.action).toBe('hash-only')
  })

  it('marks a span older than decisionTtlDays as drop-span', () => {
    const span = makeSpan({ endedAt: daysAgo(120, now), withContentRef: true })
    const out = partitionByRetention({ records: [makeRecord(0, span)], policies, now })
    expect(out.expired).toHaveLength(1)
    expect(out.expired[0]?.action).toBe('drop-span')
  })

  it('throws MissingRetentionPolicyError when the policy is not in the map', () => {
    const span = makeSpan({ endedAt: daysAgo(1, now), policyId: 'unknown.v1' })
    expect(() =>
      partitionByRetention({ records: [makeRecord(0, span)], policies, now })
    ).toThrow(MissingRetentionPolicyError)
  })

  it('preserves chain order across kept records', () => {
    const records = [
      makeRecord(0, makeSpan({ endedAt: daysAgo(1, now) })),
      makeRecord(1, makeSpan({ endedAt: daysAgo(2, now) })),
      makeRecord(2, makeSpan({ endedAt: daysAgo(3, now) })),
    ]
    const out = partitionByRetention({ records, policies, now })
    expect(out.keep.map((r) => r.sequence)).toEqual([0, 1, 2])
  })

  it('keeps a span older than fullContentTtlDays when there is no contentRef to drop', () => {
    const span = makeSpan({ endedAt: daysAgo(10, now), withContentRef: false })
    const out = partitionByRetention({ records: [makeRecord(0, span)], policies, now })
    expect(out.keep).toHaveLength(1)
    expect(out.expired).toHaveLength(0)
  })
})
