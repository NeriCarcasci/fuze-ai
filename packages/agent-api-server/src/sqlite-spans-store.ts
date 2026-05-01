import { DatabaseSync } from 'node:sqlite'
import type { ChainedRecord, EvidenceSpan } from '@fuze-ai/agent'
import type {
  SpansStore,
  SpansStoreAppendInput,
  SpansStoreQueryByRun,
  SpansStoreQueryBySubject,
} from './spans-store.js'

export interface SqliteSpansStoreOptions {
  readonly databasePath: string
}

interface SpanRow {
  tenant_id: string
  run_id: string
  sequence: number
  prev_hash: string
  hash: string
  payload_json: string
  started_at: string
  subject_hmac: string | null
}

export const migrateSpansStore = (db: DatabaseSync): void => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_spans (
      tenant_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      prev_hash TEXT NOT NULL,
      hash TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      started_at TEXT NOT NULL,
      subject_hmac TEXT,
      PRIMARY KEY (tenant_id, run_id, sequence)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_spans_subject
      ON agent_spans (tenant_id, subject_hmac);
    CREATE INDEX IF NOT EXISTS idx_agent_spans_started_at
      ON agent_spans (tenant_id, started_at);
  `)
}

export class SqliteSpansStore implements SpansStore {
  private readonly db: DatabaseSync

  constructor(opts: SqliteSpansStoreOptions) {
    this.db = new DatabaseSync(opts.databasePath)
    migrateSpansStore(this.db)
  }

  async append(input: SpansStoreAppendInput): Promise<void> {
    const stmt = this.db.prepare(
      `INSERT INTO agent_spans (
        tenant_id, run_id, sequence, prev_hash, hash, payload_json, started_at, subject_hmac
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, run_id, sequence) DO NOTHING`,
    )
    for (const record of input.records) {
      const subjectHmac = record.payload.common['fuze.subject.ref'] ?? null
      stmt.run(
        input.tenantId,
        record.payload.runId as string,
        record.sequence,
        record.prevHash,
        record.hash,
        JSON.stringify(record.payload),
        record.payload.startedAt,
        subjectHmac,
      )
    }
  }

  async byRun(input: SpansStoreQueryByRun): Promise<ChainedRecord<EvidenceSpan>[]> {
    const rows = this.db
      .prepare(
        `SELECT * FROM agent_spans
         WHERE tenant_id = ? AND run_id = ?
         ORDER BY sequence ASC`,
      )
      .all(input.tenantId, input.runId)
    return rows.map((r) => rowToRecord(r as unknown as SpanRow))
  }

  async bySubject(input: SpansStoreQueryBySubject): Promise<ChainedRecord<EvidenceSpan>[]> {
    const params: unknown[] = [input.tenantId, input.subjectHmac]
    let sql =
      `SELECT * FROM agent_spans
       WHERE tenant_id = ? AND subject_hmac = ?`
    if (input.since !== undefined) {
      sql += ' AND started_at >= ?'
      params.push(input.since)
    }
    sql += ' ORDER BY started_at ASC'
    if (input.limit !== undefined) {
      sql += ' LIMIT ?'
      params.push(input.limit)
    }
    const rows = this.db.prepare(sql).all(...(params as never[]))
    return rows.map((r) => rowToRecord(r as unknown as SpanRow))
  }

  close(): void {
    this.db.close()
  }
}

const rowToRecord = (row: SpanRow): ChainedRecord<EvidenceSpan> => ({
  sequence: row.sequence,
  prevHash: row.prev_hash,
  hash: row.hash,
  payload: JSON.parse(row.payload_json) as EvidenceSpan,
})
