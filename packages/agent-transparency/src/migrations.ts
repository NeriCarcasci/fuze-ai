import type { DatabaseSync } from 'node:sqlite'

const VERSION_DDL = `
CREATE TABLE IF NOT EXISTS schema_version (
  component TEXT PRIMARY KEY,
  version INTEGER NOT NULL
);
`

const ENTRIES_DDL = `
CREATE TABLE IF NOT EXISTS entries (
  log_index INTEGER PRIMARY KEY AUTOINCREMENT,
  log_id TEXT NOT NULL UNIQUE,
  run_id TEXT NOT NULL UNIQUE,
  chain_head TEXT NOT NULL,
  signed_run_root_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  leaf_hash TEXT NOT NULL,
  parent_hash TEXT
);

CREATE INDEX IF NOT EXISTS idx_entries_run_id ON entries(run_id);
`

const TRANSPARENCY_VERSION = 1

function setVersion(db: DatabaseSync, component: string, version: number): void {
  db.prepare(
    'INSERT INTO schema_version (component, version) VALUES (?, ?) ' +
      'ON CONFLICT(component) DO UPDATE SET version = excluded.version',
  ).run(component, version)
}

export function migrateTransparencyLog(db: DatabaseSync): void {
  db.exec(VERSION_DDL)
  db.exec(ENTRIES_DDL)
  setVersion(db, 'transparency_log', TRANSPARENCY_VERSION)
}
