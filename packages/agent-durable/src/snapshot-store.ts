import { DatabaseSync } from 'node:sqlite'
import type { ModelMessage } from '@fuze-ai/agent'
import { migrateDurableRunStore } from './migrations.js'
import type {
  CompletedToolCall,
  DurableRunSnapshot,
  DurableRunStore,
} from './types.js'

export interface SqliteDurableRunStoreOptions {
  readonly databasePath: string
}

interface RunSnapshotRow {
  run_id: string
  tenant: string
  principal: string
  subject_hmac: string | null
  steps_used: number
  retries_used: number
  chain_head: string
  last_sequence: number
  history_json: string
  completed_tool_calls_json: string
  suspended_tool_name: string | null
  suspended_tool_args_json: string | null
  snapshot_at: string
  resolved_at: string | null
}

export class SqliteDurableRunStore implements DurableRunStore {
  private readonly db: DatabaseSync

  constructor(opts: SqliteDurableRunStoreOptions) {
    this.db = new DatabaseSync(opts.databasePath)
    migrateDurableRunStore(this.db)
  }

  async save(snapshot: DurableRunSnapshot): Promise<void> {
    const stmt = this.db.prepare(
      `INSERT INTO run_snapshots (
        run_id, tenant, principal, subject_hmac,
        steps_used, retries_used, chain_head, last_sequence,
        history_json, completed_tool_calls_json,
        suspended_tool_name, suspended_tool_args_json,
        snapshot_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(run_id) DO UPDATE SET
        tenant = excluded.tenant,
        principal = excluded.principal,
        subject_hmac = excluded.subject_hmac,
        steps_used = excluded.steps_used,
        retries_used = excluded.retries_used,
        chain_head = excluded.chain_head,
        last_sequence = excluded.last_sequence,
        history_json = excluded.history_json,
        completed_tool_calls_json = excluded.completed_tool_calls_json,
        suspended_tool_name = excluded.suspended_tool_name,
        suspended_tool_args_json = excluded.suspended_tool_args_json,
        snapshot_at = excluded.snapshot_at`,
    )
    stmt.run(
      snapshot.runId,
      snapshot.tenant,
      snapshot.principal,
      snapshot.subjectHmac ?? null,
      snapshot.stepsUsed,
      snapshot.retriesUsed,
      snapshot.chainHead,
      snapshot.lastSequence,
      JSON.stringify(snapshot.history),
      JSON.stringify(snapshot.completedToolCalls),
      snapshot.suspendedToolName ?? null,
      snapshot.suspendedToolArgs === undefined ? null : JSON.stringify(snapshot.suspendedToolArgs),
      snapshot.snapshotAt,
    )
  }

  async load(runId: string): Promise<DurableRunSnapshot | null> {
    const row = this.db
      .prepare('SELECT * FROM run_snapshots WHERE run_id = ?')
      .get(runId) as RunSnapshotRow | undefined
    if (!row) return null
    return rowToSnapshot(row)
  }

  async clear(runId: string): Promise<void> {
    this.db.prepare('DELETE FROM run_snapshots WHERE run_id = ?').run(runId)
  }

  async markResolved(runId: string): Promise<void> {
    this.db
      .prepare('UPDATE run_snapshots SET resolved_at = ? WHERE run_id = ?')
      .run(new Date().toISOString(), runId)
  }

  async eraseBySubjectRef(subjectHmac: string): Promise<number> {
    const result = this.db
      .prepare('DELETE FROM run_snapshots WHERE subject_hmac = ?')
      .run(subjectHmac)
    return Number(result.changes)
  }

  async listOrphaned(olderThan: Date): Promise<readonly string[]> {
    const rows = this.db
      .prepare(
        'SELECT run_id FROM run_snapshots WHERE resolved_at IS NULL AND snapshot_at < ? ORDER BY snapshot_at ASC',
      )
      .all(olderThan.toISOString()) as { run_id: string }[]
    return rows.map((r) => r.run_id)
  }

  close(): void {
    this.db.close()
  }
}

function rowToSnapshot(row: RunSnapshotRow): DurableRunSnapshot {
  const history = JSON.parse(row.history_json) as ModelMessage[]
  const completedToolCalls = JSON.parse(row.completed_tool_calls_json) as CompletedToolCall[]
  const base: {
    runId: string
    tenant: string
    principal: string
    stepsUsed: number
    retriesUsed: number
    chainHead: string
    lastSequence: number
    history: readonly ModelMessage[]
    completedToolCalls: readonly CompletedToolCall[]
    snapshotAt: string
    subjectHmac?: string
    suspendedToolName?: string
    suspendedToolArgs?: Readonly<Record<string, unknown>>
  } = {
    runId: row.run_id,
    tenant: row.tenant,
    principal: row.principal,
    stepsUsed: row.steps_used,
    retriesUsed: row.retries_used,
    chainHead: row.chain_head,
    lastSequence: row.last_sequence,
    history,
    completedToolCalls,
    snapshotAt: row.snapshot_at,
  }
  if (row.subject_hmac !== null) base.subjectHmac = row.subject_hmac
  if (row.suspended_tool_name !== null) base.suspendedToolName = row.suspended_tool_name
  if (row.suspended_tool_args_json !== null) {
    base.suspendedToolArgs = JSON.parse(row.suspended_tool_args_json) as Record<string, unknown>
  }
  return base
}
