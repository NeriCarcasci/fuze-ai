import { describe, it, expect } from 'vitest'
import { makeRunId, makeTenantId } from '@fuze-ai/agent'
import type { ModelMessage, SubjectRef } from '@fuze-ai/agent'
import { InMemoryMemory } from '../src/in-memory.js'

const subjectA: SubjectRef = { hmac: 'subject-a-hmac', scheme: 'hmac-sha256' }
const subjectB: SubjectRef = { hmac: 'subject-b-hmac', scheme: 'hmac-sha256' }

const msg = (role: ModelMessage['role'], content: string): ModelMessage => ({ role, content })

describe('InMemoryMemory', () => {
  it('roundtrips written messages on read', async () => {
    const mem = new InMemoryMemory()
    const tenant = makeTenantId('t1')
    const runId = makeRunId('r1')
    const messages = [msg('user', 'hello'), msg('assistant', 'hi')]
    await mem.write({ tenant, runId, messages })

    const got = await mem.read({ tenant, runId })
    expect(got).toHaveLength(2)
    expect(got[0]?.content).toBe('hello')
    expect(got[1]?.content).toBe('hi')
  })

  it('isolates data between tenants', async () => {
    const mem = new InMemoryMemory()
    const runId = makeRunId('shared-run-id')
    await mem.write({
      tenant: makeTenantId('tenant-a'),
      runId,
      messages: [msg('user', 'secret-A')],
    })
    await mem.write({
      tenant: makeTenantId('tenant-b'),
      runId,
      messages: [msg('user', 'secret-B')],
    })

    const a = await mem.read({ tenant: makeTenantId('tenant-a'), runId })
    const b = await mem.read({ tenant: makeTenantId('tenant-b'), runId })

    expect(a.map((m) => m.content)).toEqual(['secret-A'])
    expect(b.map((m) => m.content)).toEqual(['secret-B'])
  })

  it('scopes data by runId within a tenant', async () => {
    const mem = new InMemoryMemory()
    const tenant = makeTenantId('t1')
    await mem.write({
      tenant,
      runId: makeRunId('run-1'),
      messages: [msg('user', 'one')],
    })
    await mem.write({
      tenant,
      runId: makeRunId('run-2'),
      messages: [msg('user', 'two')],
    })

    const r1 = await mem.read({ tenant, runId: makeRunId('run-1') })
    const r2 = await mem.read({ tenant, runId: makeRunId('run-2') })
    const missing = await mem.read({ tenant, runId: makeRunId('run-3') })

    expect(r1.map((m) => m.content)).toEqual(['one'])
    expect(r2.map((m) => m.content)).toEqual(['two'])
    expect(missing).toEqual([])
  })

  it('erases entries matching subjectRef.hmac across tenants and runs', async () => {
    const mem = new InMemoryMemory()
    const tenantA = makeTenantId('tA')
    const tenantB = makeTenantId('tB')
    const runId = makeRunId('r1')

    await mem.write({
      tenant: tenantA,
      runId,
      subjectRef: subjectA,
      messages: [msg('user', 'a-on-A')],
    })
    await mem.write({
      tenant: tenantB,
      runId,
      subjectRef: subjectA,
      messages: [msg('user', 'a-on-B')],
    })

    await mem.erase(subjectA)

    const onA = await mem.read({ tenant: tenantA, runId, subjectRef: subjectA })
    const onB = await mem.read({ tenant: tenantB, runId, subjectRef: subjectA })
    expect(onA).toEqual([])
    expect(onB).toEqual([])
  })

  it('erasure leaves other subjects intact', async () => {
    const mem = new InMemoryMemory()
    const tenant = makeTenantId('t1')
    const runId = makeRunId('r1')

    await mem.write({
      tenant,
      runId,
      subjectRef: subjectA,
      messages: [msg('user', 'A-data')],
    })
    await mem.write({
      tenant,
      runId,
      subjectRef: subjectB,
      messages: [msg('user', 'B-data')],
    })

    await mem.erase(subjectA)

    const remainingB = await mem.read({ tenant, runId, subjectRef: subjectB })
    expect(remainingB.map((m) => m.content)).toEqual(['B-data'])

    const remainingA = await mem.read({ tenant, runId, subjectRef: subjectA })
    expect(remainingA).toEqual([])
  })
})
