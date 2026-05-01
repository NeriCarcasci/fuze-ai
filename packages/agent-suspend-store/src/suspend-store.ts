import { DatabaseSync } from 'node:sqlite'
import type {
  OversightDecision,
  ResumeToken,
  SuspendStore,
  SuspendedRun,
} from '@fuze-ai/agent'
import type { RunId, StepId } from '@fuze-ai/agent'
import { migrateSuspendStore } from './migrations.js'

export interface SqliteSuspendStoreOptions {
  readonly databasePath: string
}

interface SuspendedRunRow {
  run_id: string
  subject_hmac: string | null
  suspended_at_sequence: number
  chain_head_at_suspend: string
  tool_name: string
  tool_args_json: string
  reason: string
  resume_token_json: string
  decision_json: string | null
  decided_at: string | null
  suspended_at_span_id: string
  definition_fingerprint: string | null
}

export class SqliteSuspendStore implements SuspendStore {
  private readonly db: DatabaseSync

  constructor(opts: SqliteSuspendStoreOptions) {
    this.db = new DatabaseSync(opts.databasePath)
    migrateSuspendStore(this.db)
  }

  async save(run: SuspendedRun): Promise<void> {
    await this.saveWithSubject(run)
  }

  async saveWithSubject(run: SuspendedRun, subjectHmac?: string): Promise<void> {
    const stmt = this.db.prepare(
      `INSERT INTO suspended_runs (
        run_id, subject_hmac, suspended_at_span_id, suspended_at_sequence,
        chain_head_at_suspend, tool_name, tool_args_json, reason,
        resume_token_json, decision_json, decided_at, definition_fingerprint
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
      ON CONFLICT(run_id) DO UPDATE SET
        subject_hmac = excluded.subject_hmac,
        suspended_at_span_id = excluded.suspended_at_span_id,
        suspended_at_sequence = excluded.suspended_at_sequence,
        chain_head_at_suspend = excluded.chain_head_at_suspend,
        tool_name = excluded.tool_name,
        tool_args_json = excluded.tool_args_json,
        reason = excluded.reason,
        resume_token_json = excluded.resume_token_json,
        definition_fingerprint = excluded.definition_fingerprint,
        decision_json = NULL,
        decided_at = NULL`,
    )
    stmt.run(
      run.runId as string,
      subjectHmac ?? null,
      run.suspendedAtSpanId as string,
      run.suspendedAtSequence,
      run.chainHeadAtSuspend,
      run.toolName,
      JSON.stringify(run.toolArgs),
      run.reason,
      JSON.stringify(run.resumeToken),
      run.definitionFingerprint,
    )
  }

  async load(runId: RunId): Promise<SuspendedRun | null> {
    const row = this.db
      .prepare('SELECT * FROM suspended_runs WHERE run_id = ?')
      .get(runId as string) as SuspendedRunRow | undefined
    if (!row) return null
    return rowToSuspendedRun(row)
  }

  async markResumed(runId: RunId, decision: OversightDecision): Promise<void> {
    const stmt = this.db.prepare(
      `UPDATE suspended_runs
       SET decision_json = ?, decided_at = ?
       WHERE run_id = ?`,
    )
    stmt.run(JSON.stringify(decision), new Date().toISOString(), runId as string)
  }

  async eraseBySubjectRef(subjectHmac: string): Promise<number> {
    const result = this.db
      .prepare('DELETE FROM suspended_runs WHERE subject_hmac = ?')
      .run(subjectHmac)
    return Number(result.changes)
  }

  close(): void {
    this.db.close()
  }
}

function rowToSuspendedRun(row: SuspendedRunRow): SuspendedRun {
  const resumeToken = JSON.parse(row.resume_token_json) as ResumeToken
  const toolArgs = JSON.parse(row.tool_args_json) as Record<string, unknown>
  return {
    runId: row.run_id as RunId,
    suspendedAtSpanId: row.suspended_at_span_id as StepId,
    suspendedAtSequence: row.suspended_at_sequence,
    chainHeadAtSuspend: row.chain_head_at_suspend,
    toolName: row.tool_name,
    toolArgs,
    reason: row.reason,
    resumeToken,
    definitionFingerprint: row.definition_fingerprint ?? '',
  }
}
