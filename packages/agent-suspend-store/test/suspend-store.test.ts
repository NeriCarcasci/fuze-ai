import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { OversightDecision, SuspendedRun } from '@fuze-ai/agent'
import { makeRunId, makeStepId } from '@fuze-ai/agent'
import { SqliteSuspendStore } from '../src/suspend-store.js'
import { migrateSuspendStore } from '../src/migrations.js'
import { DatabaseSync } from 'node:sqlite'

function makeRun(id: string, overrides: Partial<SuspendedRun> = {}): SuspendedRun {
  return {
    runId: makeRunId(id),
    suspendedAtSpanId: makeStepId(`span-${id}`),
    suspendedAtSequence: 7,
    chainHeadAtSuspend: 'deadbeef',
    toolName: 'send_email',
    toolArgs: { to: 'a@example.com', subject: 'hi' },
    reason: 'awaiting human approval',
    resumeToken: {
      runId: makeRunId(id),
      suspendedAtSequence: 7,
      chainHeadAtSuspend: 'deadbeef',
      nonce: `nonce-${id}`,
      signature: 'sig-' + id,
      publicKeyId: 'kid-1',
    },
    definitionFingerprint: `fp-${id}`,
    ...overrides,
  }
}

const decision: OversightDecision = {
  action: 'approve',
  rationale: 'looks fine',
  overseerId: 'overseer-1',
}

describe('SqliteSuspendStore', () => {
  let store: SqliteSuspendStore

  beforeEach(() => {
    store = new SqliteSuspendStore({ databasePath: ':memory:' })
  })

  afterEach(() => {
    store.close()
  })

  it('saves and loads a SuspendedRun roundtrip', async () => {
    const run = makeRun('r1')
    await store.save(run)
    const loaded = await store.load(run.runId)
    expect(loaded).not.toBeNull()
    expect(loaded?.runId).toBe(run.runId)
    expect(loaded?.toolName).toBe('send_email')
    expect(loaded?.toolArgs).toEqual({ to: 'a@example.com', subject: 'hi' })
    expect(loaded?.resumeToken.nonce).toBe('nonce-r1')
    expect(loaded?.suspendedAtSequence).toBe(7)
    expect(loaded?.chainHeadAtSuspend).toBe('deadbeef')
    expect(loaded?.suspendedAtSpanId).toBe('span-r1')
  })

  it('load returns null for unknown runId', async () => {
    const result = await store.load(makeRunId('nope'))
    expect(result).toBeNull()
  })

  it('markResumed writes decision and decided_at', async () => {
    const run = makeRun('r2')
    await store.save(run)
    await store.markResumed(run.runId, decision)

    const row = (store as unknown as {
      db: InstanceType<typeof DatabaseSync>
    }).db
      .prepare('SELECT decision_json, decided_at FROM suspended_runs WHERE run_id = ?')
      .get(run.runId as string) as { decision_json: string; decided_at: string }

    expect(row.decision_json).toBeTruthy()
    expect(row.decided_at).toBeTruthy()
    const parsed = JSON.parse(row.decision_json) as OversightDecision
    expect(parsed.action).toBe('approve')
    expect(parsed.overseerId).toBe('overseer-1')
  })

  it('eraseBySubjectRef removes only matching rows', async () => {
    const a = makeRun('a')
    const b = makeRun('b')
    const c = makeRun('c')
    await store.saveWithSubject(a, 'subject-x')
    await store.saveWithSubject(b, 'subject-y')
    await store.saveWithSubject(c, 'subject-x')

    const erased = await store.eraseBySubjectRef('subject-x')
    expect(erased).toBe(2)

    expect(await store.load(a.runId)).toBeNull()
    expect(await store.load(c.runId)).toBeNull()
    expect(await store.load(b.runId)).not.toBeNull()
  })

  it('eraseBySubjectRef returns correct count when no matches', async () => {
    await store.saveWithSubject(makeRun('only'), 'subject-real')
    const erased = await store.eraseBySubjectRef('does-not-exist')
    expect(erased).toBe(0)
  })

  it('save with same runId replaces existing row idempotently', async () => {
    const run1 = makeRun('same', { reason: 'first' })
    await store.save(run1)
    const run2 = makeRun('same', { reason: 'second' })
    await store.save(run2)

    const loaded = await store.load(makeRunId('same'))
    expect(loaded?.reason).toBe('second')
  })

  it('migration is idempotent', () => {
    const db = new DatabaseSync(':memory:')
    expect(() => {
      migrateSuspendStore(db)
      migrateSuspendStore(db)
      migrateSuspendStore(db)
    }).not.toThrow()
    db.close()
  })

  it('in-memory database works for full lifecycle', async () => {
    const ephemeral = new SqliteSuspendStore({ databasePath: ':memory:' })
    const run = makeRun('mem')
    await ephemeral.save(run)
    await ephemeral.markResumed(run.runId, decision)
    const loaded = await ephemeral.load(run.runId)
    expect(loaded).not.toBeNull()
    ephemeral.close()
  })
})
