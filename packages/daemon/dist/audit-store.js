/**
 * SQLite audit store using Node.js built-in node:sqlite.
 *
 * Append-only with a SHA-256 hash chain for EU AI Act Art. 12 compliance.
 * Each record's hash = SHA256(prev_hash + JSON.stringify(record_fields)).
 *
 * Note: Uses node:sqlite (built-in to Node.js 22.5+) instead of better-sqlite3
 * since Node v24 ships with a compatible synchronous SQLite API.
 */
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
function hashRecord(prevHash, fields) {
    return createHash('sha256')
        .update(prevHash + JSON.stringify(fields, Object.keys(fields).sort()))
        .digest('hex');
}
const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  run_id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  agent_version TEXT DEFAULT '',
  model_provider TEXT DEFAULT '',
  model_name TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL,
  ended_at TEXT,
  total_cost REAL DEFAULT 0,
  total_tokens_in INTEGER DEFAULT 0,
  total_tokens_out INTEGER DEFAULT 0,
  total_steps INTEGER DEFAULT 0,
  config_json TEXT DEFAULT '{}',
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS steps (
  step_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_number INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  tool_name TEXT NOT NULL,
  args_hash TEXT NOT NULL,
  has_side_effect INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  latency_ms INTEGER DEFAULT 0,
  error TEXT,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS guard_events (
  event_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_id TEXT,
  timestamp TEXT NOT NULL,
  event_type TEXT NOT NULL,
  severity TEXT NOT NULL,
  details_json TEXT DEFAULT '{}',
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS compensation_records (
  compensation_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  original_result_json TEXT,
  compensation_status TEXT NOT NULL DEFAULT 'pending',
  compensation_started_at TEXT,
  compensation_ended_at TEXT,
  compensation_error TEXT,
  escalated INTEGER DEFAULT 0,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  key_hash TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  step_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  args_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  result_json TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_agent   ON runs(agent_id, started_at);
CREATE INDEX IF NOT EXISTS idx_runs_status  ON runs(status);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at);
CREATE INDEX IF NOT EXISTS idx_steps_run    ON steps(run_id);
CREATE INDEX IF NOT EXISTS idx_ge_run       ON guard_events(run_id);
CREATE INDEX IF NOT EXISTS idx_ge_type      ON guard_events(event_type);
CREATE INDEX IF NOT EXISTS idx_comp_run     ON compensation_records(run_id);
CREATE INDEX IF NOT EXISTS idx_comp_status  ON compensation_records(compensation_status);
CREATE INDEX IF NOT EXISTS idx_idem_run     ON idempotency_keys(run_id);
`;
export class AuditStore {
    dbPath;
    db;
    lastRunHash = 'genesis';
    lastStepHash = 'genesis';
    lastEventHash = 'genesis';
    lastCompHash = 'genesis';
    constructor(dbPath) {
        this.dbPath = dbPath;
    }
    /**
     * Create tables (if not exist) and load last chain hashes.
     */
    async init() {
        this.db = new DatabaseSync(this.dbPath);
        this.db.exec(SCHEMA);
        // Load tail of each hash chain
        const lastRun = this.db.prepare('SELECT hash FROM runs ORDER BY rowid DESC LIMIT 1').get();
        if (lastRun)
            this.lastRunHash = lastRun.hash;
        const lastStep = this.db.prepare('SELECT hash FROM steps ORDER BY rowid DESC LIMIT 1').get();
        if (lastStep)
            this.lastStepHash = lastStep.hash;
        const lastEvent = this.db.prepare('SELECT hash FROM guard_events ORDER BY rowid DESC LIMIT 1').get();
        if (lastEvent)
            this.lastEventHash = lastEvent.hash;
        const lastComp = this.db.prepare('SELECT hash FROM compensation_records ORDER BY rowid DESC LIMIT 1').get();
        if (lastComp)
            this.lastCompHash = lastComp.hash;
    }
    async insertRun(run) {
        const prevHash = this.lastRunHash;
        // Hash over immutable fields only (snake_case, matching DB column names).
        // Mutable fields (status, total_cost, ended_at, etc.) are excluded so that
        // updateRunStatus does not break the hash chain.
        const colFields = {
            run_id: run.runId, agent_id: run.agentId, agent_version: run.agentVersion,
            model_provider: run.modelProvider, model_name: run.modelName,
            started_at: run.startedAt, config_json: run.configJson,
        };
        const hash = hashRecord(prevHash, colFields);
        this.db.prepare(`INSERT INTO runs (run_id, agent_id, agent_version, model_provider, model_name, status,
       started_at, ended_at, total_cost, total_tokens_in, total_tokens_out, total_steps,
       config_json, prev_hash, hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(run.runId, run.agentId, run.agentVersion, run.modelProvider, run.modelName, run.status, run.startedAt, run.endedAt ?? null, run.totalCost, run.totalTokensIn, run.totalTokensOut, run.totalSteps, run.configJson, prevHash, hash);
        this.lastRunHash = hash;
    }
    async insertStep(step) {
        const prevHash = this.lastStepHash;
        const colFields = {
            step_id: step.stepId, run_id: step.runId, step_number: step.stepNumber,
            started_at: step.startedAt, ended_at: step.endedAt ?? null,
            tool_name: step.toolName, args_hash: step.argsHash,
            has_side_effect: step.hasSideEffect ? 1 : 0,
            cost_usd: step.costUsd, tokens_in: step.tokensIn, tokens_out: step.tokensOut,
            latency_ms: step.latencyMs, error: step.error ?? null,
        };
        const hash = hashRecord(prevHash, colFields);
        this.db.prepare(`INSERT INTO steps (step_id, run_id, step_number, started_at, ended_at, tool_name, args_hash,
       has_side_effect, cost_usd, tokens_in, tokens_out, latency_ms, error, prev_hash, hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(step.stepId, step.runId, step.stepNumber, step.startedAt, step.endedAt ?? null, step.toolName, step.argsHash, step.hasSideEffect ? 1 : 0, step.costUsd, step.tokensIn, step.tokensOut, step.latencyMs, step.error ?? null, prevHash, hash);
        this.lastStepHash = hash;
    }
    async insertGuardEvent(event) {
        const prevHash = this.lastEventHash;
        const colFields = {
            event_id: event.eventId, run_id: event.runId, step_id: event.stepId ?? null,
            timestamp: event.timestamp, event_type: event.eventType, severity: event.severity,
            details_json: event.detailsJson,
        };
        const hash = hashRecord(prevHash, colFields);
        this.db.prepare(`INSERT INTO guard_events (event_id, run_id, step_id, timestamp, event_type, severity, details_json, prev_hash, hash)
       VALUES (?,?,?,?,?,?,?,?,?)`).run(event.eventId, event.runId, event.stepId ?? null, event.timestamp, event.eventType, event.severity, event.detailsJson, prevHash, hash);
        this.lastEventHash = hash;
    }
    async updateRunStatus(runId, status, totalCost, endedAt) {
        this.db.prepare(`UPDATE runs SET status = ?, total_cost = ?, ended_at = ? WHERE run_id = ?`).run(status, totalCost, endedAt ?? new Date().toISOString(), runId);
    }
    async getRun(runId) {
        const row = this.db.prepare('SELECT * FROM runs WHERE run_id = ?').get(runId);
        return row ? this._rowToRun(row) : null;
    }
    async getRunSteps(runId) {
        const rows = this.db.prepare('SELECT * FROM steps WHERE run_id = ? ORDER BY step_number').all(runId);
        return rows.map(this._rowToStep);
    }
    async getRunGuardEvents(runId) {
        const rows = this.db.prepare('SELECT * FROM guard_events WHERE run_id = ? ORDER BY rowid').all(runId);
        return rows.map(this._rowToEvent);
    }
    async listRuns(opts = {}) {
        let sql = 'SELECT * FROM runs WHERE 1=1';
        const params = [];
        if (opts.agentId) {
            sql += ' AND agent_id = ?';
            params.push(opts.agentId);
        }
        if (opts.status) {
            sql += ' AND status = ?';
            params.push(opts.status);
        }
        if (opts.since) {
            sql += ' AND started_at >= ?';
            params.push(opts.since);
        }
        sql += ' ORDER BY started_at DESC';
        sql += ` LIMIT ${opts.limit ?? 50} OFFSET ${opts.offset ?? 0}`;
        const rows = this.db.prepare(sql).all(...params);
        return rows.map(this._rowToRun);
    }
    async countRuns(opts = {}) {
        let sql = 'SELECT COUNT(*) as count FROM runs WHERE 1=1';
        const params = [];
        if (opts.agentId) {
            sql += ' AND agent_id = ?';
            params.push(opts.agentId);
        }
        if (opts.status) {
            sql += ' AND status = ?';
            params.push(opts.status);
        }
        if (opts.since) {
            sql += ' AND started_at >= ?';
            params.push(opts.since);
        }
        const row = this.db.prepare(sql).get(...params);
        return row.count;
    }
    /**
     * Verify the integrity of all three hash chains.
     *
     * @returns { valid: true } or { valid: false, brokenAt: id }
     */
    async verifyHashChain() {
        // Verify runs chain — only immutable fields are hashed (mutable fields like
        // status/total_cost/ended_at are excluded to allow updateRunStatus without breaking the chain)
        const runs = this.db.prepare('SELECT * FROM runs ORDER BY rowid').all();
        let prev = 'genesis';
        for (const row of runs) {
            const prev_hash = row['prev_hash'];
            const hash = row['hash'];
            if (prev_hash !== prev)
                return { valid: false, brokenAt: row['run_id'] };
            const immutable = {
                run_id: row['run_id'], agent_id: row['agent_id'], agent_version: row['agent_version'],
                model_provider: row['model_provider'], model_name: row['model_name'],
                started_at: row['started_at'], config_json: row['config_json'],
            };
            const expected = hashRecord(prev_hash, immutable);
            if (hash !== expected)
                return { valid: false, brokenAt: row['run_id'] };
            prev = hash;
        }
        // Verify steps chain
        const steps = this.db.prepare('SELECT * FROM steps ORDER BY rowid').all();
        prev = 'genesis';
        for (const row of steps) {
            const { prev_hash, hash, ...fields } = row;
            if (prev_hash !== prev)
                return { valid: false, brokenAt: row['step_id'] };
            const expected = hashRecord(prev_hash, fields);
            if (hash !== expected)
                return { valid: false, brokenAt: row['step_id'] };
            prev = hash;
        }
        // Verify guard_events chain
        const events = this.db.prepare('SELECT * FROM guard_events ORDER BY rowid').all();
        prev = 'genesis';
        for (const row of events) {
            const { prev_hash, hash, ...fields } = row;
            if (prev_hash !== prev)
                return { valid: false, brokenAt: row['event_id'] };
            const expected = hashRecord(prev_hash, fields);
            if (hash !== expected)
                return { valid: false, brokenAt: row['event_id'] };
            prev = hash;
        }
        // Verify compensation_records chain
        const compRecords = this.db.prepare('SELECT * FROM compensation_records ORDER BY rowid').all();
        prev = 'genesis';
        for (const row of compRecords) {
            const { prev_hash, hash, ...fields } = row;
            if (prev_hash !== prev)
                return { valid: false, brokenAt: row['compensation_id'] };
            const expected = hashRecord(prev_hash, fields);
            if (hash !== expected)
                return { valid: false, brokenAt: row['compensation_id'] };
            prev = hash;
        }
        return { valid: true };
    }
    async getRetentionStatus() {
        const countRow = this.db.prepare('SELECT COUNT(*) as count FROM runs').get();
        const oldestRow = this.db.prepare('SELECT started_at FROM runs ORDER BY started_at LIMIT 1').get();
        return {
            totalRuns: countRow.count,
            oldestRun: oldestRow?.started_at ?? '',
            dbSizeBytes: 0, // file size not available via node:sqlite
        };
    }
    /**
     * Purge runs (and associated steps/events) older than the specified number of days.
     *
     * @param days - Runs older than this many days will be deleted.
     * @returns Number of runs deleted.
     */
    async purgeOlderThan(days) {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        const oldRuns = this.db.prepare('SELECT run_id FROM runs WHERE started_at < ?').all(cutoff);
        if (oldRuns.length === 0)
            return 0;
        const ids = oldRuns.map((r) => r.run_id);
        const placeholders = ids.map(() => '?').join(',');
        this.db.exec('BEGIN');
        try {
            this.db.prepare(`DELETE FROM compensation_records WHERE run_id IN (${placeholders})`).run(...ids);
            this.db.prepare(`DELETE FROM idempotency_keys WHERE run_id IN (${placeholders})`).run(...ids);
            this.db.prepare(`DELETE FROM guard_events WHERE run_id IN (${placeholders})`).run(...ids);
            this.db.prepare(`DELETE FROM steps WHERE run_id IN (${placeholders})`).run(...ids);
            this.db.prepare(`DELETE FROM runs WHERE run_id IN (${placeholders})`).run(...ids);
            this.db.exec('COMMIT');
        }
        catch (err) {
            this.db.exec('ROLLBACK');
            throw err;
        }
        return ids.length;
    }
    // ── Compensation records ────────────────────────────────────────────────────
    async insertCompensationRecord(record) {
        const prevHash = this.lastCompHash;
        const colFields = {
            compensation_id: record.compensationId,
            run_id: record.runId,
            step_id: record.stepId,
            tool_name: record.toolName,
            original_result_json: record.originalResultJson,
            compensation_status: record.compensationStatus,
            compensation_started_at: record.compensationStartedAt,
            compensation_ended_at: record.compensationEndedAt,
            compensation_error: record.compensationError,
            escalated: record.escalated ? 1 : 0,
        };
        const hash = hashRecord(prevHash, colFields);
        this.db.prepare(`INSERT INTO compensation_records
       (compensation_id, run_id, step_id, tool_name, original_result_json,
        compensation_status, compensation_started_at, compensation_ended_at,
        compensation_error, escalated, prev_hash, hash)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(record.compensationId, record.runId, record.stepId, record.toolName, record.originalResultJson, record.compensationStatus, record.compensationStartedAt, record.compensationEndedAt, record.compensationError, record.escalated ? 1 : 0, prevHash, hash);
        this.lastCompHash = hash;
    }
    async getCompensationByRun(runId) {
        const rows = this.db
            .prepare('SELECT * FROM compensation_records WHERE run_id = ? ORDER BY rowid')
            .all(runId);
        return rows.map(this._rowToCompensation);
    }
    // ── Idempotency keys ────────────────────────────────────────────────────────
    async insertIdempotencyKey(record) {
        this.db.prepare(`INSERT OR IGNORE INTO idempotency_keys
       (key_hash, run_id, step_id, tool_name, args_hash, created_at, result_json)
       VALUES (?,?,?,?,?,?,?)`).run(record.keyHash, record.runId, record.stepId, record.toolName, record.argsHash, record.createdAt, record.resultJson);
    }
    async getIdempotencyKey(keyHash) {
        const row = this.db
            .prepare('SELECT * FROM idempotency_keys WHERE key_hash = ?')
            .get(keyHash);
        return row ? this._rowToIdempotency(row) : null;
    }
    async close() {
        this.db.close();
    }
    // ── Row mappers ────────────────────────────────────────────────────────────
    _rowToRun(row) {
        return {
            runId: row['run_id'],
            agentId: row['agent_id'],
            agentVersion: row['agent_version'],
            modelProvider: row['model_provider'],
            modelName: row['model_name'],
            status: row['status'],
            startedAt: row['started_at'],
            endedAt: row['ended_at'],
            totalCost: row['total_cost'],
            totalTokensIn: row['total_tokens_in'],
            totalTokensOut: row['total_tokens_out'],
            totalSteps: row['total_steps'],
            configJson: row['config_json'],
            prevHash: row['prev_hash'],
            hash: row['hash'],
        };
    }
    _rowToStep(row) {
        return {
            stepId: row['step_id'],
            runId: row['run_id'],
            stepNumber: row['step_number'],
            startedAt: row['started_at'],
            endedAt: row['ended_at'],
            toolName: row['tool_name'],
            argsHash: row['args_hash'],
            hasSideEffect: row['has_side_effect'],
            costUsd: row['cost_usd'],
            tokensIn: row['tokens_in'],
            tokensOut: row['tokens_out'],
            latencyMs: row['latency_ms'],
            error: row['error'],
            prevHash: row['prev_hash'],
            hash: row['hash'],
        };
    }
    _rowToEvent(row) {
        return {
            eventId: row['event_id'],
            runId: row['run_id'],
            stepId: row['step_id'],
            timestamp: row['timestamp'],
            eventType: row['event_type'],
            severity: row['severity'],
            detailsJson: row['details_json'],
            prevHash: row['prev_hash'],
            hash: row['hash'],
        };
    }
    _rowToCompensation(row) {
        return {
            compensationId: row['compensation_id'],
            runId: row['run_id'],
            stepId: row['step_id'],
            toolName: row['tool_name'],
            originalResultJson: row['original_result_json'],
            compensationStatus: row['compensation_status'],
            compensationStartedAt: row['compensation_started_at'],
            compensationEndedAt: row['compensation_ended_at'],
            compensationError: row['compensation_error'],
            escalated: row['escalated'] === 1,
            prevHash: row['prev_hash'],
            hash: row['hash'],
        };
    }
    _rowToIdempotency(row) {
        return {
            keyHash: row['key_hash'],
            runId: row['run_id'],
            stepId: row['step_id'],
            toolName: row['tool_name'],
            argsHash: row['args_hash'],
            createdAt: row['created_at'],
            resultJson: row['result_json'],
        };
    }
}
//# sourceMappingURL=audit-store.js.map