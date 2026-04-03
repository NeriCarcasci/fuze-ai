/**
 * SQLite-backed cache for tool configurations pulled from the Fuze cloud API
 * or set by local tool registration. Shares the same DB file as AuditStore
 * but uses separate tables so the audit log is never affected.
 */
import { DatabaseSync } from 'node:sqlite';
const SCHEMA = `
CREATE TABLE IF NOT EXISTS tool_config_cache (
  tool_name  TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  max_retries INTEGER NOT NULL DEFAULT 3,
  max_budget  REAL    NOT NULL DEFAULT 1.0,
  timeout_ms  INTEGER NOT NULL DEFAULT 30000,
  enabled     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT    NOT NULL
);
CREATE TABLE IF NOT EXISTS config_sync_state (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;
function rowToConfig(row) {
    return {
        maxRetries: row.max_retries,
        maxBudget: row.max_budget,
        timeout: row.timeout_ms,
        enabled: row.enabled === 1,
        updatedAt: row.updated_at,
    };
}
export class ConfigCache {
    db;
    constructor(storagePath) {
        this.db = new DatabaseSync(storagePath);
    }
    init() {
        this.db.exec(SCHEMA);
    }
    /**
     * Replace all tool configs for a project with the provided map.
     * Used by ApiSync when a fresh /v1/tools/config response arrives.
     */
    setToolConfigs(projectId, tools) {
        const del = this.db.prepare('DELETE FROM tool_config_cache WHERE project_id = ?');
        const ins = this.db.prepare(`INSERT INTO tool_config_cache
         (tool_name, project_id, max_retries, max_budget, timeout_ms, enabled, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`);
        del.run(projectId);
        for (const [name, cfg] of Object.entries(tools)) {
            ins.run(name, projectId, cfg.maxRetries, cfg.maxBudget, cfg.timeout, cfg.enabled ? 1 : 0, cfg.updatedAt);
        }
    }
    /**
     * Upsert a single tool config (used by register_tools for local-only defaults).
     */
    upsertToolConfig(projectId, toolName, cfg) {
        const stmt = this.db.prepare(`INSERT INTO tool_config_cache
         (tool_name, project_id, max_retries, max_budget, timeout_ms, enabled, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tool_name) DO NOTHING`);
        stmt.run(toolName, projectId, cfg.maxRetries, cfg.maxBudget, cfg.timeout, cfg.enabled ? 1 : 0, cfg.updatedAt);
    }
    getToolConfig(toolName) {
        const stmt = this.db.prepare('SELECT * FROM tool_config_cache WHERE tool_name = ?');
        const row = stmt.get(toolName);
        return row ? rowToConfig(row) : null;
    }
    getAllToolConfigs() {
        const stmt = this.db.prepare('SELECT * FROM tool_config_cache');
        const rows = stmt.all();
        const result = {};
        for (const row of rows) {
            result[row.tool_name] = rowToConfig(row);
        }
        return result;
    }
    getSyncState(key) {
        const stmt = this.db.prepare('SELECT value FROM config_sync_state WHERE key = ?');
        const row = stmt.get(key);
        return row?.value ?? null;
    }
    setSyncState(key, value) {
        const stmt = this.db.prepare('INSERT OR REPLACE INTO config_sync_state (key, value) VALUES (?, ?)');
        stmt.run(key, value);
    }
    close() {
        this.db.close();
    }
}
//# sourceMappingURL=config-cache.js.map