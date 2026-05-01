import { DatabaseSync } from 'node:sqlite'
import type { ResumeTokenStore } from '@fuze-ai/agent'
import { migrateNonceStore } from './migrations.js'

export interface SqliteNonceStoreOptions {
  readonly databasePath: string
}

export class SqliteNonceStore implements ResumeTokenStore {
  private readonly db: DatabaseSync

  constructor(opts: SqliteNonceStoreOptions) {
    this.db = new DatabaseSync(opts.databasePath)
    migrateNonceStore(this.db)
  }

  async has(nonce: string): Promise<boolean> {
    const row = this.db
      .prepare('SELECT 1 AS one FROM consumed_nonces WHERE nonce = ?')
      .get(nonce) as { one: number } | undefined
    return row !== undefined
  }

  async consume(nonce: string): Promise<void> {
    this.db
      .prepare(
        'INSERT INTO consumed_nonces (nonce, consumed_at) VALUES (?, ?) ' +
          'ON CONFLICT(nonce) DO NOTHING',
      )
      .run(nonce, new Date().toISOString())
  }

  close(): void {
    this.db.close()
  }
}
