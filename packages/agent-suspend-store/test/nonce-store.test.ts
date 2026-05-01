import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { SqliteNonceStore } from '../src/nonce-store.js'
import { migrateNonceStore } from '../src/migrations.js'
import { DatabaseSync } from 'node:sqlite'

describe('SqliteNonceStore', () => {
  let store: SqliteNonceStore

  beforeEach(() => {
    store = new SqliteNonceStore({ databasePath: ':memory:' })
  })

  afterEach(() => {
    store.close()
  })

  it('has returns false for a never-seen nonce', async () => {
    expect(await store.has('fresh-nonce')).toBe(false)
  })

  it('consume marks nonce as seen', async () => {
    await store.consume('n-1')
    expect(await store.has('n-1')).toBe(true)
  })

  it('has returns true after consume, false for others', async () => {
    await store.consume('seen')
    expect(await store.has('seen')).toBe(true)
    expect(await store.has('unseen')).toBe(false)
  })

  it('consume of an already-consumed nonce is a no-op (does not throw)', async () => {
    await store.consume('replay')
    await expect(store.consume('replay')).resolves.toBeUndefined()
    await expect(store.consume('replay')).resolves.toBeUndefined()
    expect(await store.has('replay')).toBe(true)
  })

  it('migration is idempotent for nonce store', () => {
    const db = new DatabaseSync(':memory:')
    expect(() => {
      migrateNonceStore(db)
      migrateNonceStore(db)
    }).not.toThrow()
    db.close()
  })
})
