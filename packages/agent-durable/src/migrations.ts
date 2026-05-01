import type { DatabaseSync } from 'node:sqlite'

const VERSION_DDL = `
CREATE TABLE IF NOT EXISTS schema_version (
  component TEXT PRIMARY KEY,
  version INTEGER NOT NULL
);
`

const RUN_SNAPSHOTS_DDL = `
CREATE TABLE IF NOT EXISTS run_snapshots (
  run_id TEXT PRIMARY KEY,
  tenant TEXT NOT NULL,
  principal TEXT NOT NULL,
  subject_hmac TEXT,
  steps_used INTEGER NOT NULL,
  retries_used INTEGER NOT NULL,
  chain_head TEXT NOT NULL,
  last_sequence INTEGER NOT NULL,
  history_json TEXT NOT NULL,
  completed_tool_calls_json TEXT NOT NULL,
  suspended_tool_name TEXT,
  suspended_tool_args_json TEXT,
  snapshot_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_run_snapshots_subject ON run_snapshots(subject_hmac);
CREATE INDEX IF NOT EXISTS idx_run_snapshots_orphans ON run_snapshots(resolved_at, snapshot_at);
`

const DURABLE_VERSION = 1

function setVersion(db: DatabaseSync, component: string, version: number): void {
  db.prepare(
    'INSERT INTO schema_version (component, version) VALUES (?, ?) ' +
      'ON CONFLICT(component) DO UPDATE SET version = excluded.version',
  ).run(component, version)
}

export function migrateDurableRunStore(db: DatabaseSync): void {
  db.exec(VERSION_DDL)
  db.exec(RUN_SNAPSHOTS_DDL)
  setVersion(db, 'durable_run_store', DURABLE_VERSION)
}
