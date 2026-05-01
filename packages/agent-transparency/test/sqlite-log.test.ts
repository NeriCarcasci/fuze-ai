import { describe, it, expect } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type { SignedRunRoot } from '@fuze-ai/agent'
import { SqliteTransparencyLog, leafHashOf } from '../src/sqlite-log.js'
import { migrateTransparencyLog } from '../src/migrations.js'
import {
  TransparencyDuplicateError,
  TransparencyNotFoundError,
  type TransparencyEntry,
} from '../src/types.js'

const signedRunRoot = (runId: string): SignedRunRoot => ({
  runId,
  chainHead: 'a'.repeat(64),
  nonce: 'n-' + runId,
  signature: 's-' + runId,
  publicKeyId: 'pk-test',
  algorithm: 'ed25519',
})

const makeEntry = (runId: string, observedAt = '2026-04-30T00:00:00.000Z'): TransparencyEntry => ({
  runId,
  chainHead: 'a'.repeat(64),
  signedRunRoot: signedRunRoot(runId),
  observedAt,
})

describe('SqliteTransparencyLog', () => {
  it('append + prove + verify roundtrip', async () => {
    const log = new SqliteTransparencyLog({ databasePath: ':memory:' })
    const anchor = await log.append(makeEntry('run-1'))
    expect(anchor.logIndex).toBe(1)
    expect(anchor.logName).toBe('fuze-sqlite-transparency')
    const proof = await log.prove(anchor.logId)
    expect(await log.verify(proof)).toBe(true)
    log.close()
  })

  it('two appends chain by parent_hash', async () => {
    const log = new SqliteTransparencyLog({ databasePath: ':memory:' })
    const e1 = makeEntry('run-1')
    const e2 = makeEntry('run-2')
    const a1 = await log.append(e1)
    const a2 = await log.append(e2)
    // Reach into the underlying DB to inspect parent_hash chaining.
    const db = (log as unknown as { db: DatabaseSync }).db
    const rows = db
      .prepare('SELECT log_index, leaf_hash, parent_hash FROM entries ORDER BY log_index ASC')
      .all() as { log_index: number; leaf_hash: string; parent_hash: string | null }[]
    expect(rows.length).toBe(2)
    expect(rows[0]!.parent_hash).toBeNull()
    expect(rows[1]!.parent_hash).toBe(rows[0]!.leaf_hash)
    expect(rows[0]!.leaf_hash).toBe(leafHashOf(e1))
    expect(rows[1]!.leaf_hash).toBe(leafHashOf(e2))
    expect(a1.logIndex).toBe(1)
    expect(a2.logIndex).toBe(2)
    log.close()
  })

  it('rejects duplicate runId', async () => {
    const log = new SqliteTransparencyLog({ databasePath: ':memory:' })
    await log.append(makeEntry('run-dup'))
    await expect(log.append(makeEntry('run-dup'))).rejects.toBeInstanceOf(
      TransparencyDuplicateError,
    )
    // Verify the first entry is still the only one and is intact.
    const db = (log as unknown as { db: DatabaseSync }).db
    const count = db.prepare('SELECT COUNT(*) AS c FROM entries').get() as { c: number }
    expect(count.c).toBe(1)
    log.close()
  })

  it('prove returns NotFoundError for unknown logId', async () => {
    const log = new SqliteTransparencyLog({ databasePath: ':memory:' })
    await log.append(makeEntry('run-1'))
    await expect(log.prove('does-not-exist')).rejects.toBeInstanceOf(TransparencyNotFoundError)
    log.close()
  })

  it('verify with tampered entry returns false', async () => {
    const log = new SqliteTransparencyLog({ databasePath: ':memory:' })
    const anchor = await log.append(makeEntry('run-1'))
    await log.append(makeEntry('run-2'))
    const proof = await log.prove(anchor.logId)
    const tampered = {
      ...proof,
      entry: { ...proof.entry, chainHead: 'b'.repeat(64) },
    }
    expect(await log.verify(tampered)).toBe(false)
    log.close()
  })

  it('in-memory db works across multiple appends and proves', async () => {
    const log = new SqliteTransparencyLog({ databasePath: ':memory:' })
    const anchors = []
    for (let i = 0; i < 5; i++) {
      anchors.push(await log.append(makeEntry(`run-${i}`)))
    }
    for (const a of anchors) {
      const p = await log.prove(a.logId)
      expect(await log.verify(p)).toBe(true)
    }
    log.close()
  })

  it('migration is idempotent', () => {
    const db = new DatabaseSync(':memory:')
    migrateTransparencyLog(db)
    migrateTransparencyLog(db)
    migrateTransparencyLog(db)
    const ver = db
      .prepare("SELECT version FROM schema_version WHERE component = 'transparency_log'")
      .get() as { version: number }
    expect(ver.version).toBe(1)
    db.close()
  })

  it('atomic append rolls back on duplicate so log stays consistent', async () => {
    const log = new SqliteTransparencyLog({ databasePath: ':memory:' })
    await log.append(makeEntry('run-1'))
    await log.append(makeEntry('run-2'))
    await expect(log.append(makeEntry('run-1'))).rejects.toBeInstanceOf(
      TransparencyDuplicateError,
    )
    const db = (log as unknown as { db: DatabaseSync }).db
    const rows = db.prepare('SELECT run_id FROM entries ORDER BY log_index').all() as {
      run_id: string
    }[]
    expect(rows.map((r) => r.run_id)).toEqual(['run-1', 'run-2'])
    // log_index sequence wasn't advanced by the rolled-back insert.
    const max = db.prepare('SELECT MAX(log_index) AS m FROM entries').get() as { m: number }
    expect(max.m).toBe(2)
    log.close()
  })

  it('verify rejects malformed merkleProof', async () => {
    const log = new SqliteTransparencyLog({ databasePath: ':memory:' })
    const anchor = await log.append(makeEntry('run-1'))
    await log.append(makeEntry('run-2'))
    const proof = await log.prove(anchor.logId)
    const bad = { ...proof, merkleProof: ['not-a-step'] }
    expect(await log.verify(bad)).toBe(false)
    log.close()
  })
})
