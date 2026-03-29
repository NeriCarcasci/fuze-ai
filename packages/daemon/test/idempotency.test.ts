import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { randomUUID } from 'node:crypto'
import { AuditStore } from '../src/audit-store.js'
import { IdempotencyManager } from '../src/compensation/idempotency.js'

function tmpDb(): string {
  return path.join(os.tmpdir(), `fuze-idem-test-${Date.now()}-${randomUUID().slice(0, 6)}.sqlite`)
}

async function makeManager(dbPath: string): Promise<{ mgr: IdempotencyManager; store: AuditStore }> {
  const store = new AuditStore(dbPath)
  await store.init()
  return { mgr: new IdempotencyManager(store), store }
}

describe('IdempotencyManager', () => {
  const dbs: string[] = []

  afterEach(() => {
    for (const db of dbs) {
      try { fs.unlinkSync(db) } catch { /* ignore */ }
    }
    dbs.length = 0
  })

  it('same tool+args in same run → isDuplicate returns true', async () => {
    const db = tmpDb(); dbs.push(db)
    const { mgr } = await makeManager(db)

    const runId = 'run-1'
    const key = mgr.generateKey(runId, 'echo', 'hash-abc')
    expect(await mgr.isDuplicate(key)).toBe(false)

    await mgr.recordExecution(key, runId, 'step-1', 'echo', 'hash-abc', { ok: true })

    expect(await mgr.isDuplicate(key)).toBe(true)
  })

  it('same tool+args in different run → NOT duplicate', async () => {
    const db = tmpDb(); dbs.push(db)
    const { mgr } = await makeManager(db)

    const key1 = mgr.generateKey('run-1', 'echo', 'hash-abc')
    const key2 = mgr.generateKey('run-2', 'echo', 'hash-abc')

    await mgr.recordExecution(key1, 'run-1', 'step-1', 'echo', 'hash-abc', { ok: true })

    // Different run — key2 not yet recorded
    expect(await mgr.isDuplicate(key2)).toBe(false)
  })

  it('getCachedResult returns stored result for duplicate', async () => {
    const db = tmpDb(); dbs.push(db)
    const { mgr } = await makeManager(db)

    const key = mgr.generateKey('run-1', 'search', 'hash-xyz')
    const payload = { results: ['a', 'b', 'c'] }
    await mgr.recordExecution(key, 'run-1', 'step-1', 'search', 'hash-xyz', payload)

    const cached = await mgr.getCachedResult(key)
    expect(cached).toEqual(payload)
  })

  it('getCachedResult returns null for non-existent key', async () => {
    const db = tmpDb(); dbs.push(db)
    const { mgr } = await makeManager(db)

    const key = mgr.generateKey('run-999', 'nonexistent', 'hash-000')
    const cached = await mgr.getCachedResult(key)
    expect(cached).toBeNull()
  })

  it('generateKey is deterministic', async () => {
    const db = tmpDb(); dbs.push(db)
    const { mgr } = await makeManager(db)

    const key1 = mgr.generateKey('run-1', 'echo', 'abc')
    const key2 = mgr.generateKey('run-1', 'echo', 'abc')
    expect(key1).toBe(key2)
  })

  it('generateKey differs for different runIds', async () => {
    const db = tmpDb(); dbs.push(db)
    const { mgr } = await makeManager(db)

    const key1 = mgr.generateKey('run-1', 'echo', 'abc')
    const key2 = mgr.generateKey('run-2', 'echo', 'abc')
    expect(key1).not.toBe(key2)
  })

  it('generateKey differs for different toolNames', async () => {
    const db = tmpDb(); dbs.push(db)
    const { mgr } = await makeManager(db)

    const key1 = mgr.generateKey('run-1', 'echo', 'abc')
    const key2 = mgr.generateKey('run-1', 'search', 'abc')
    expect(key1).not.toBe(key2)
  })

  it('recordExecution is INSERT OR IGNORE — no-op on duplicate', async () => {
    const db = tmpDb(); dbs.push(db)
    const { mgr } = await makeManager(db)

    const key = mgr.generateKey('run-1', 'echo', 'abc')
    await mgr.recordExecution(key, 'run-1', 'step-1', 'echo', 'abc', { v: 1 })
    // Second insert should not throw
    await expect(
      mgr.recordExecution(key, 'run-1', 'step-2', 'echo', 'abc', { v: 2 }),
    ).resolves.not.toThrow()

    // Cached result is still from first insert
    const cached = await mgr.getCachedResult(key) as { v: number }
    expect(cached.v).toBe(1)
  })
})
