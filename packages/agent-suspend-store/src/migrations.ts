import type { DatabaseSync } from 'node:sqlite'

const SUSPENDED_RUNS_DDL = `
CREATE TABLE IF NOT EXISTS suspended_runs (
  run_id TEXT PRIMARY KEY,
  subject_hmac TEXT,
  suspended_at_span_id TEXT NOT NULL,
  suspended_at_sequence INTEGER NOT NULL,
  chain_head_at_suspend TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_args_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  resume_token_json TEXT NOT NULL,
  decision_json TEXT,
  decided_at TEXT,
  definition_fingerprint TEXT
);

CREATE INDEX IF NOT EXISTS idx_suspended_runs_subject ON suspended_runs(subject_hmac);
`

const ADD_FINGERPRINT_DDL = `
ALTER TABLE suspended_runs ADD COLUMN definition_fingerprint TEXT;
`

const CONSUMED_NONCES_DDL = `
CREATE TABLE IF NOT EXISTS consumed_nonces (
  nonce TEXT PRIMARY KEY,
  consumed_at TEXT NOT NULL
);
`

const VERSION_DDL = `
CREATE TABLE IF NOT EXISTS schema_version (
  component TEXT PRIMARY KEY,
  version INTEGER NOT NULL
);
`

const SUSPEND_VERSION = 1
const NONCE_VERSION = 1

function setVersion(db: DatabaseSync, component: string, version: number): void {
  db.prepare(
    'INSERT INTO schema_version (component, version) VALUES (?, ?) ' +
      'ON CONFLICT(component) DO UPDATE SET version = excluded.version',
  ).run(component, version)
}

export function migrateSuspendStore(db: DatabaseSync): void {
  db.exec(VERSION_DDL)
  db.exec(SUSPENDED_RUNS_DDL)
  try {
    db.exec(ADD_FINGERPRINT_DDL)
  } catch {
    // column already exists; ALTER TABLE on existing schemas without the column adds it
  }
  setVersion(db, 'suspend_store', SUSPEND_VERSION)
}

export function migrateNonceStore(db: DatabaseSync): void {
  db.exec(VERSION_DDL)
  db.exec(CONSUMED_NONCES_DDL)
  setVersion(db, 'nonce_store', NONCE_VERSION)
}
