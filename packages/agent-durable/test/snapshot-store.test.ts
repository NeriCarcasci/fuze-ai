import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { ModelMessage } from '@fuze-ai/agent'
import { SqliteDurableRunStore } from '../src/snapshot-store.js'
import { migrateDurableRunStore } from '../src/migrations.js'
import type { DurableRunSnapshot } from '../src/types.js'

function makeSnapshot(
  runId: string,
  overrides: Partial<DurableRunSnapshot> = {},
): DurableRunSnapshot {
  const history: ModelMessage[] = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'hi back' },
  ]
  return {
    runId,
    tenant: 'tenant-1',
    principal: 'principal-1',
    stepsUsed: 2,
    retriesUsed: 0,
    chainHead: 'a'.repeat(64),
    lastSequence: 5,
    history,
    completedToolCalls: [
      { toolName: 'send_email', argsHash: 'arg-h-1', outputHash: 'out-h-1' },
    ],
    snapshotAt: new Date('2026-04-30T10:00:00Z').toISOString(),
    ...overrides,
  }
}

describe('SqliteDurableRunStore', () => {
  let store: SqliteDurableRunStore

  beforeEach(() => {
    store = new SqliteDurableRunStore({ databasePath: ':memory:' })
  })

  afterEach(() => {
    store.close()
  })

  it('saves and loads a snapshot roundtrip', async () => {
    const snap = makeSnapshot('r1')
    await store.save(snap)
    const loaded = await store.load('r1')
    expect(loaded).not.toBeNull()
    expect(loaded?.runId).toBe('r1')
    expect(loaded?.tenant).toBe('tenant-1')
    expect(loaded?.principal).toBe('principal-1')
    expect(loaded?.stepsUsed).toBe(2)
    expect(loaded?.retriesUsed).toBe(0)
    expect(loaded?.chainHead).toBe('a'.repeat(64))
    expect(loaded?.lastSequence).toBe(5)
  })

  it('load returns null for unknown runId', async () => {
    const result = await store.load('nope')
    expect(result).toBeNull()
  })

  it('save with same runId replaces (latest snapshot wins)', async () => {
    await store.save(makeSnapshot('same', { stepsUsed: 1, chainHead: 'b'.repeat(64) }))
    await store.save(makeSnapshot('same', { stepsUsed: 4, chainHead: 'c'.repeat(64) }))

    const loaded = await store.load('same')
    expect(loaded?.stepsUsed).toBe(4)
    expect(loaded?.chainHead).toBe('c'.repeat(64))
  })

  it('eraseBySubjectRef removes only matching rows and returns count', async () => {
    await store.save(makeSnapshot('a', { subjectHmac: 'subj-x' }))
    await store.save(makeSnapshot('b', { subjectHmac: 'subj-y' }))
    await store.save(makeSnapshot('c', { subjectHmac: 'subj-x' }))

    const erased = await store.eraseBySubjectRef('subj-x')
    expect(erased).toBe(2)

    expect(await store.load('a')).toBeNull()
    expect(await store.load('c')).toBeNull()
    expect(await store.load('b')).not.toBeNull()
  })

  it('eraseBySubjectRef returns 0 when no matches', async () => {
    await store.save(makeSnapshot('only', { subjectHmac: 'real' }))
    const erased = await store.eraseBySubjectRef('absent')
    expect(erased).toBe(0)
  })

  it('clear removes a single snapshot', async () => {
    await store.save(makeSnapshot('keep'))
    await store.save(makeSnapshot('drop'))
    await store.clear('drop')
    expect(await store.load('drop')).toBeNull()
    expect(await store.load('keep')).not.toBeNull()
  })

  it('listOrphaned returns runIds older than threshold with no resolved decision', async () => {
    await store.save(
      makeSnapshot('old-unresolved', {
        snapshotAt: new Date('2026-01-01T00:00:00Z').toISOString(),
      }),
    )
    await store.save(
      makeSnapshot('old-resolved', {
        snapshotAt: new Date('2026-01-01T00:00:00Z').toISOString(),
      }),
    )
    await store.markResolved('old-resolved')
    await store.save(
      makeSnapshot('recent', {
        snapshotAt: new Date('2026-04-29T23:00:00Z').toISOString(),
      }),
    )

    const orphaned = await store.listOrphaned(new Date('2026-04-01T00:00:00Z'))
    expect(orphaned).toEqual(['old-unresolved'])
  })

  it('markResolved sets resolved_at and removes from listOrphaned', async () => {
    await store.save(
      makeSnapshot('r', {
        snapshotAt: new Date('2026-01-01T00:00:00Z').toISOString(),
      }),
    )
    let orphaned = await store.listOrphaned(new Date('2026-04-01T00:00:00Z'))
    expect(orphaned).toContain('r')

    await store.markResolved('r')
    orphaned = await store.listOrphaned(new Date('2026-04-01T00:00:00Z'))
    expect(orphaned).not.toContain('r')
  })

  it('migration is idempotent', () => {
    const db = new DatabaseSync(':memory:')
    expect(() => {
      migrateDurableRunStore(db)
      migrateDurableRunStore(db)
      migrateDurableRunStore(db)
    }).not.toThrow()
    db.close()
  })

  it('in-memory database works for full lifecycle', async () => {
    const ephemeral = new SqliteDurableRunStore({ databasePath: ':memory:' })
    const snap = makeSnapshot('mem')
    await ephemeral.save(snap)
    await ephemeral.markResolved('mem')
    const loaded = await ephemeral.load('mem')
    expect(loaded).not.toBeNull()
    ephemeral.close()
  })

  it('history serialises and deserialises through JSON', async () => {
    const history: ModelMessage[] = [
      { role: 'system', content: 'sys prompt' },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'thinking' },
      { role: 'tool', content: '{"k":1}', toolCallId: 'call-1', name: 'lookup' },
    ]
    await store.save(makeSnapshot('h', { history }))
    const loaded = await store.load('h')
    expect(loaded?.history).toEqual(history)
  })

  it('completedToolCalls serialises correctly', async () => {
    const calls = [
      { toolName: 'a', argsHash: 'aa', outputHash: 'aaa' },
      { toolName: 'b', argsHash: 'bb', outputHash: 'bbb' },
      { toolName: 'c', argsHash: 'cc', outputHash: 'ccc' },
    ]
    await store.save(makeSnapshot('c', { completedToolCalls: calls }))
    const loaded = await store.load('c')
    expect(loaded?.completedToolCalls).toEqual(calls)
  })

  it('persists suspendedToolName and suspendedToolArgs when provided', async () => {
    await store.save(
      makeSnapshot('s', {
        suspendedToolName: 'send_email',
        suspendedToolArgs: { to: 'x@example.com', subject: 'hi' },
      }),
    )
    const loaded = await store.load('s')
    expect(loaded?.suspendedToolName).toBe('send_email')
    expect(loaded?.suspendedToolArgs).toEqual({ to: 'x@example.com', subject: 'hi' })
  })

  it('omits subjectHmac, suspendedToolName, suspendedToolArgs when not set', async () => {
    await store.save(makeSnapshot('plain'))
    const loaded = await store.load('plain')
    expect(loaded).not.toBeNull()
    expect(loaded?.subjectHmac).toBeUndefined()
    expect(loaded?.suspendedToolName).toBeUndefined()
    expect(loaded?.suspendedToolArgs).toBeUndefined()
  })
})
