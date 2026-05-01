import { describe, expect, it } from 'vitest'
import { HashChain } from '@fuze-ai/agent'
import type { ChainedRecord, EvidenceSpan } from '@fuze-ai/agent'
import { SqliteSpansStore } from '../src/sqlite-spans-store.js'

const buildSpans = (
  runId: string,
  count = 3,
  subjectHmac = 'subj-hmac-A',
  baseSeconds = 0,
): ChainedRecord<EvidenceSpan>[] => {
  const chain = new HashChain<EvidenceSpan>()
  const records: ChainedRecord<EvidenceSpan>[] = []
  for (let i = 0; i < count; i++) {
    const span: EvidenceSpan = {
      span: `s-${i}`,
      role: 'agent',
      runId: runId as never,
      stepId: `step-${i}` as never,
      startedAt: new Date(2025, 0, 1, 0, 0, baseSeconds + i).toISOString(),
      endedAt: new Date(2025, 0, 1, 0, 0, baseSeconds + i, 1).toISOString(),
      common: {
        'fuze.tenant.id': 't-1' as never,
        'fuze.principal.id': 'p-1' as never,
        'fuze.annex_iii_domain': 'none',
        'fuze.art22_decision': false,
        'fuze.retention.policy_id': 'r-1',
        'fuze.subject.ref': subjectHmac,
      },
      attrs: { i },
    }
    records.push(chain.append(span))
  }
  return records
}

describe('SqliteSpansStore', () => {
  it('append + byRun roundtrip preserves order and chain integrity', async () => {
    const store = new SqliteSpansStore({ databasePath: ':memory:' })
    const records = buildSpans('run-1', 4)
    await store.append({ tenantId: 't-1', records })
    const out = await store.byRun({ tenantId: 't-1', runId: 'run-1' })
    expect(out).toHaveLength(4)
    expect(out.map((r) => r.sequence)).toEqual([0, 1, 2, 3])
    expect(out[0]?.hash).toBe(records[0]?.hash)
    expect(out[3]?.payload.span).toBe('s-3')
    store.close()
  })

  it('bySubject filter returns only matching subject and respects limit', async () => {
    const store = new SqliteSpansStore({ databasePath: ':memory:' })
    await store.append({ tenantId: 't-1', records: buildSpans('run-A', 3, 'subj-X') })
    await store.append({ tenantId: 't-1', records: buildSpans('run-B', 3, 'subj-Y', 10) })
    const xOnly = await store.bySubject({ tenantId: 't-1', subjectHmac: 'subj-X' })
    expect(xOnly).toHaveLength(3)
    for (const r of xOnly) {
      expect(r.payload.common['fuze.subject.ref']).toBe('subj-X')
    }
    const limited = await store.bySubject({ tenantId: 't-1', subjectHmac: 'subj-Y', limit: 2 })
    expect(limited).toHaveLength(2)
    store.close()
  })

  it('isolates spans by tenant', async () => {
    const store = new SqliteSpansStore({ databasePath: ':memory:' })
    await store.append({ tenantId: 't-1', records: buildSpans('run-shared', 2, 'subj-Z') })
    await store.append({ tenantId: 't-2', records: buildSpans('run-shared', 5, 'subj-Z') })
    const t1 = await store.byRun({ tenantId: 't-1', runId: 'run-shared' })
    const t2 = await store.byRun({ tenantId: 't-2', runId: 'run-shared' })
    expect(t1).toHaveLength(2)
    expect(t2).toHaveLength(5)
    const t1Subj = await store.bySubject({ tenantId: 't-1', subjectHmac: 'subj-Z' })
    expect(t1Subj).toHaveLength(2)
    store.close()
  })

  it('bySubject with since drops earlier records', async () => {
    const store = new SqliteSpansStore({ databasePath: ':memory:' })
    const records = buildSpans('run-1', 5, 'subj-S')
    await store.append({ tenantId: 't-1', records })
    const cutoff = records[2]?.payload.startedAt as string
    const out = await store.bySubject({ tenantId: 't-1', subjectHmac: 'subj-S', since: cutoff })
    expect(out).toHaveLength(3)
    expect(out[0]?.payload.startedAt).toBe(cutoff)
    store.close()
  })

  it('returns empty arrays for unknown run / subject', async () => {
    const store = new SqliteSpansStore({ databasePath: ':memory:' })
    expect(await store.byRun({ tenantId: 't-1', runId: 'unknown' })).toEqual([])
    expect(await store.bySubject({ tenantId: 't-1', subjectHmac: 'unknown' })).toEqual([])
    store.close()
  })

  it('works with an in-memory database (no path)', async () => {
    const store = new SqliteSpansStore({ databasePath: ':memory:' })
    await store.append({ tenantId: 't-1', records: buildSpans('run-mem', 2) })
    const out = await store.byRun({ tenantId: 't-1', runId: 'run-mem' })
    expect(out).toHaveLength(2)
    store.close()
  })

  it('append is idempotent on (tenant, run, sequence) collisions', async () => {
    const store = new SqliteSpansStore({ databasePath: ':memory:' })
    const records = buildSpans('run-dup', 3)
    await store.append({ tenantId: 't-1', records })
    await store.append({ tenantId: 't-1', records })
    const out = await store.byRun({ tenantId: 't-1', runId: 'run-dup' })
    expect(out).toHaveLength(3)
    store.close()
  })
})
