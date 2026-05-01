import { describe, expect, it } from 'vitest'
import { createFuzeAgentApiServer } from '../src/server.js'
import { InMemorySpansStore } from '../src/spans-store.js'
import { BearerAuth } from '../src/auth.js'
import { SqliteSuspendStore } from '@fuze-ai/agent-suspend-store'
import { HashChain } from '@fuze-ai/agent'
import type { ChainedRecord, EvidenceSpan, SuspendedRun } from '@fuze-ai/agent'
import { PATHS } from '@fuze-ai/agent-api'

const buildSpan = (runId: string, tenantId: string): ChainedRecord<EvidenceSpan>[] => {
  const chain = new HashChain<EvidenceSpan>()
  return [
    chain.append({
      span: 's',
      role: 'agent',
      runId: runId as never,
      stepId: 'step-0' as never,
      startedAt: '2026-04-30T00:00:00Z',
      endedAt: '2026-04-30T00:00:00Z',
      common: {
        'fuze.tenant.id': tenantId as never,
        'fuze.principal.id': 'p' as never,
        'fuze.annex_iii_domain': 'none',
        'fuze.art22_decision': false,
        'fuze.retention.policy_id': 'r',
      },
      attrs: {},
    }),
  ]
}

const buildSuspended = (runId: string): SuspendedRun => ({
  runId: runId as never,
  suspendedAtSpanId: 'step-0' as never,
  suspendedAtSequence: 0,
  chainHeadAtSuspend: 'a'.repeat(64),
  toolName: 'tool',
  toolArgs: {},
  reason: 'wait',
  resumeToken: {
    runId: runId as never,
    suspendedAtSequence: 0,
    chainHeadAtSuspend: 'a'.repeat(64),
    nonce: 'n',
    signature: 'cw==',
    publicKeyId: 'k',
  },
  definitionFingerprint: 'fp',
})

const makeApp = () => {
  const suspendStore = new SqliteSuspendStore({ databasePath: ':memory:' })
  const spansStore = new InMemorySpansStore()
  const auth = new BearerAuth(
    new Map([
      ['key-A', { tenantId: 'tenant-A', principalId: 'pA' }],
      ['key-B', { tenantId: 'tenant-B', principalId: 'pB' }],
    ]),
  )
  return createFuzeAgentApiServer({ suspendStore, spansStore, auth })
}

describe('cross-tenant isolation', () => {
  it('tenant B cannot read a suspended run owned by tenant A', async () => {
    const app = makeApp()
    const post = await app.fetch(
      new Request(`http://x${PATHS.suspendedRuns}`, {
        method: 'POST',
        body: JSON.stringify({ suspendedRun: buildSuspended('run-x') }),
        headers: { 'content-type': 'application/json', authorization: 'Bearer key-A' },
      }),
    )
    expect(post.status).toBe(201)

    const stealAttempt = await app.fetch(
      new Request(`http://x${PATHS.suspendedRun('run-x')}`, {
        headers: { authorization: 'Bearer key-B' } as Record<string, string> as unknown as Headers,
      }),
    )
    expect(stealAttempt.status).toBe(403)
  })

  it('tenant B cannot post a decision on tenant A run', async () => {
    const app = makeApp()
    await app.fetch(
      new Request(`http://x${PATHS.suspendedRuns}`, {
        method: 'POST',
        body: JSON.stringify({ suspendedRun: buildSuspended('run-y') }),
        headers: { 'content-type': 'application/json', authorization: 'Bearer key-A' },
      }),
    )
    const stealAttempt = await app.fetch(
      new Request(`http://x${PATHS.suspendedRunDecisions('run-y')}`, {
        method: 'POST',
        body: JSON.stringify({
          decision: { action: 'approve', rationale: 'forge', overseerId: 'attacker' },
        }),
        headers: { 'content-type': 'application/json', authorization: 'Bearer key-B' },
      }),
    )
    expect(stealAttempt.status).toBe(403)
  })

  it('tenant B cannot fetch verify for tenant A run', async () => {
    const app = makeApp()
    await app.fetch(
      new Request(`http://x${PATHS.spans}`, {
        method: 'POST',
        body: JSON.stringify({ spans: buildSpan('run-z', 'tenant-A') }),
        headers: { 'content-type': 'application/json', authorization: 'Bearer key-A' },
      }),
    )
    const stealAttempt = await app.fetch(
      new Request(`http://x${PATHS.runVerify('run-z')}`, {
        headers: { authorization: 'Bearer key-B' } as Record<string, string> as unknown as Headers,
      }),
    )
    expect(stealAttempt.status).toBe(403)
  })

  it('unknown runId returns 404 not 403', async () => {
    const app = makeApp()
    const res = await app.fetch(
      new Request(`http://x${PATHS.suspendedRun('never-existed')}`, {
        headers: { authorization: 'Bearer key-A' } as Record<string, string> as unknown as Headers,
      }),
    )
    expect(res.status).toBe(404)
  })
})
