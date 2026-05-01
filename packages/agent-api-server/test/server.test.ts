import { describe, expect, it } from 'vitest'
import { createFuzeAgentApiServer } from '../src/server.js'
import { InMemorySpansStore } from '../src/spans-store.js'
import { BearerAuth } from '../src/auth.js'
import { SqliteSuspendStore } from '@fuze-ai/agent-suspend-store'
import { HashChain } from '@fuze-ai/agent'
import type { ChainedRecord, EvidenceSpan, OversightDecision, SuspendedRun } from '@fuze-ai/agent'
import { PATHS } from '@fuze-ai/agent-api'

const makeStores = () => {
  const suspendStore = new SqliteSuspendStore({ databasePath: ':memory:' })
  const spansStore = new InMemorySpansStore()
  const auth = new BearerAuth(
    new Map([['key-1', { tenantId: 't-1', principalId: 'p-1' }]]),
  )
  return { suspendStore, spansStore, auth }
}

const buildSpans = (runId: string, count = 3): ChainedRecord<EvidenceSpan>[] => {
  const chain = new HashChain<EvidenceSpan>()
  const records: ChainedRecord<EvidenceSpan>[] = []
  for (let i = 0; i < count; i++) {
    const span: EvidenceSpan = {
      span: `s-${i}`,
      role: 'agent',
      runId: runId as never,
      stepId: `step-${i}` as never,
      startedAt: new Date(2025, 0, 1, 0, 0, i).toISOString(),
      endedAt: new Date(2025, 0, 1, 0, 0, i, 1).toISOString(),
      common: {
        'fuze.tenant.id': 't-1' as never,
        'fuze.principal.id': 'p-1' as never,
        'fuze.annex_iii_domain': 'none',
        'fuze.art22_decision': false,
        'fuze.retention.policy_id': 'r-1',
        'fuze.subject.ref': 'subj-hmac',
      },
      attrs: { i },
    }
    records.push(chain.append(span))
  }
  return records
}

const buildSuspended = (runId: string): SuspendedRun => ({
  runId: runId as never,
  suspendedAtSpanId: 'step-3' as never,
  suspendedAtSequence: 3,
  chainHeadAtSuspend: 'a'.repeat(64),
  toolName: 'transfer',
  toolArgs: { amount: 100 },
  reason: 'awaiting overseer',
  resumeToken: {
    runId: runId as never,
    suspendedAtSequence: 3,
    chainHeadAtSuspend: 'a'.repeat(64),
    nonce: 'nonce-1',
    signature: Buffer.from('sig').toString('base64'),
    publicKeyId: 'kid-1',
  },
  definitionFingerprint: 'fp-1',
})

const auth = (h: Record<string, string> = {}) => ({
  authorization: 'Bearer key-1',
  ...h,
})

describe('agent-api-server', () => {
  it('GET /v1/health returns 200', async () => {
    const { suspendStore, spansStore, auth: a } = makeStores()
    const app = createFuzeAgentApiServer({ suspendStore, spansStore, auth: a })
    const res = await app.fetch(new Request(`http://x${PATHS.health}`))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('rejects POST /v1/spans without auth', async () => {
    const { suspendStore, spansStore, auth: a } = makeStores()
    const app = createFuzeAgentApiServer({ suspendStore, spansStore, auth: a })
    const res = await app.fetch(
      new Request(`http://x${PATHS.spans}`, {
        method: 'POST',
        body: JSON.stringify({ spans: [] }),
        headers: { 'content-type': 'application/json' },
      }),
    )
    expect(res.status).toBe(401)
  })

  it('rejects POST /v1/spans with bad bearer', async () => {
    const { suspendStore, spansStore, auth: a } = makeStores()
    const app = createFuzeAgentApiServer({ suspendStore, spansStore, auth: a })
    const res = await app.fetch(
      new Request(`http://x${PATHS.spans}`, {
        method: 'POST',
        body: JSON.stringify({ spans: [] }),
        headers: { 'content-type': 'application/json', authorization: 'Bearer bad-key' },
      }),
    )
    expect(res.status).toBe(403)
  })

  it('POST /v1/spans accepts a valid record array', async () => {
    const { suspendStore, spansStore, auth: a } = makeStores()
    const app = createFuzeAgentApiServer({ suspendStore, spansStore, auth: a })
    const records = buildSpans('run-1')
    const res = await app.fetch(
      new Request(`http://x${PATHS.spans}`, {
        method: 'POST',
        body: JSON.stringify({ spans: records }),
        headers: { 'content-type': 'application/json', ...auth() },
      }),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { accepted: number }
    expect(body.accepted).toBe(records.length)
  })

  it('POST /v1/suspended-runs and GET /v1/suspended-runs/:id roundtrip', async () => {
    const { suspendStore, spansStore, auth: a } = makeStores()
    const app = createFuzeAgentApiServer({ suspendStore, spansStore, auth: a })
    const suspended = buildSuspended('run-2')
    const post = await app.fetch(
      new Request(`http://x${PATHS.suspendedRuns}`, {
        method: 'POST',
        body: JSON.stringify({ suspendedRun: suspended }),
        headers: { 'content-type': 'application/json', ...auth() },
      }),
    )
    expect(post.status).toBe(201)
    const get = await app.fetch(
      new Request(`http://x${PATHS.suspendedRun('run-2')}`, {
        headers: auth() as unknown as Headers,
      }),
    )
    expect(get.status).toBe(200)
    const body = (await get.json()) as { suspended: SuspendedRun }
    expect(body.suspended.runId).toBe('run-2')
  })

  it('GET /v1/suspended-runs/:id returns 404 for unknown', async () => {
    const { suspendStore, spansStore, auth: a } = makeStores()
    const app = createFuzeAgentApiServer({ suspendStore, spansStore, auth: a })
    const res = await app.fetch(
      new Request(`http://x${PATHS.suspendedRun('does-not-exist')}`, {
        headers: auth() as unknown as Headers,
      }),
    )
    expect(res.status).toBe(404)
  })

  it('POST decision then GET decision returns the recorded decision', async () => {
    const { suspendStore, spansStore, auth: a } = makeStores()
    const app = createFuzeAgentApiServer({ suspendStore, spansStore, auth: a })
    await app.fetch(
      new Request(`http://x${PATHS.suspendedRuns}`, {
        method: 'POST',
        body: JSON.stringify({ suspendedRun: buildSuspended('run-3') }),
        headers: { 'content-type': 'application/json', ...auth() },
      }),
    )
    const decision: OversightDecision = {
      action: 'approve',
      rationale: 'ok',
      overseerId: 'overseer-1',
    }
    const post = await app.fetch(
      new Request(`http://x${PATHS.suspendedRunDecisions('run-3')}`, {
        method: 'POST',
        body: JSON.stringify({ decision }),
        headers: { 'content-type': 'application/json', ...auth() },
      }),
    )
    expect(post.status).toBe(201)

    const get = await app.fetch(
      new Request(`http://x${PATHS.runDecisions('run-3')}`, {
        headers: auth() as unknown as Headers,
      }),
    )
    expect(get.status).toBe(200)
    const body = (await get.json()) as { decision: OversightDecision }
    expect(body.decision.action).toBe('approve')
  })

  it('GET /v1/runs/:runId/decisions long-poll wakes when decision arrives', async () => {
    const { suspendStore, spansStore, auth: a } = makeStores()
    const app = createFuzeAgentApiServer({ suspendStore, spansStore, auth: a, maxLongPollMs: 2000 })
    await app.fetch(
      new Request(`http://x${PATHS.suspendedRuns}`, {
        method: 'POST',
        body: JSON.stringify({ suspendedRun: buildSuspended('run-4') }),
        headers: { 'content-type': 'application/json', ...auth() },
      }),
    )
    const pollPromise = app.fetch(
      new Request(`http://x${PATHS.runDecisions('run-4')}?wait=2`, {
        headers: auth() as unknown as Headers,
      }),
    )
    setTimeout(() => {
      void app.fetch(
        new Request(`http://x${PATHS.suspendedRunDecisions('run-4')}`, {
          method: 'POST',
          body: JSON.stringify({
            decision: { action: 'reject', rationale: 'no', overseerId: 'o-1' },
          }),
          headers: { 'content-type': 'application/json', ...auth() },
        }),
      )
    }, 50)
    const res = await pollPromise
    expect(res.status).toBe(200)
  })

  it('GET decisions long-poll returns 404 on timeout', async () => {
    const { suspendStore, spansStore, auth: a } = makeStores()
    const app = createFuzeAgentApiServer({ suspendStore, spansStore, auth: a })
    const res = await app.fetch(
      new Request(`http://x${PATHS.runDecisions('never-decided')}?wait=1`, {
        headers: auth() as unknown as Headers,
      }),
    )
    expect(res.status).toBe(404)
  })

  it('GET /v1/subjects/:hmac/spans filters by subject', async () => {
    const { suspendStore, spansStore, auth: a } = makeStores()
    const app = createFuzeAgentApiServer({ suspendStore, spansStore, auth: a })
    await spansStore.append({ tenantId: 't-1', records: buildSpans('run-5') })
    const res = await app.fetch(
      new Request(`http://x${PATHS.subjectSpans('subj-hmac')}`, {
        headers: auth() as unknown as Headers,
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { spans: ChainedRecord<EvidenceSpan>[] }
    expect(body.spans.length).toBeGreaterThan(0)
  })

  it('GET /v1/runs/:runId/verify reports chain validity', async () => {
    const { suspendStore, spansStore, auth: a } = makeStores()
    const app = createFuzeAgentApiServer({ suspendStore, spansStore, auth: a })
    const records = buildSpans('run-6', 4)
    const ingest = await app.fetch(
      new Request(`http://x${PATHS.spans}`, {
        method: 'POST',
        body: JSON.stringify({ spans: records }),
        headers: { 'content-type': 'application/json', ...auth() },
      }),
    )
    expect(ingest.status).toBe(201)
    const res = await app.fetch(
      new Request(`http://x${PATHS.runVerify('run-6')}`, {
        headers: auth() as unknown as Headers,
      }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { chainValid: boolean; anchorVerified: boolean; spanCount: number }
    expect(body.chainValid).toBe(true)
    expect(body.anchorVerified).toBe(false)
    expect(body.spanCount).toBe(4)
  })

  it('GET /v1/runs/:runId/verify returns 404 when no spans', async () => {
    const { suspendStore, spansStore, auth: a } = makeStores()
    const app = createFuzeAgentApiServer({ suspendStore, spansStore, auth: a })
    const res = await app.fetch(
      new Request(`http://x${PATHS.runVerify('empty-run')}`, {
        headers: auth() as unknown as Headers,
      }),
    )
    expect(res.status).toBe(404)
  })
})
