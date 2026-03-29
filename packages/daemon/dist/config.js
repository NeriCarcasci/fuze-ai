import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
/**
 * Returns the appropriate IPC path for the current platform.
 * Windows uses named pipes; Unix uses a socket file in /tmp.
 */
export function defaultSocketPath() {
    return process.platform === 'win32'
        ? '\\\\.\\pipe\\fuze-daemon'
        : path.join(os.tmpdir(), 'fuze-daemon.sock');
}
const DEFAULTS = {
    socketPath: defaultSocketPath(),
    apiPort: 7821,
    storagePath: path.join(os.homedir(), '.fuze', 'audit.db'),
    retentionDays: 90,
    budget: {
        orgDailyBudget: 100,
        perAgentDailyBudget: 20,
        alertThreshold: 0.8,
    },
    alerts: {
        dedupWindowMs: 60_000,
        webhookUrls: [],
    },
};
/**
 * Load daemon config from a fuze.toml file (if present) and merge with defaults.
 *
 * The `[daemon]` section is used. All fields are optional; missing fields
 * fall back to DEFAULTS.
 *
 * @param configPath - Explicit path to fuze.toml. Defaults to searching
 *   cwd → home directory.
 */
export function loadDaemonConfig(configPath) {
    const tomlPath = configPath ?? findToml();
    if (!tomlPath)
        return structuredClone(DEFAULTS);
    let raw;
    try {
        raw = fs.readFileSync(tomlPath, 'utf8');
    }
    catch {
        return structuredClone(DEFAULTS);
    }
    const parsed = parseToml(raw);
    const daemon = (parsed['daemon'] ?? {});
    return {
        socketPath: daemon['socket_path'] ?? DEFAULTS.socketPath,
        apiPort: daemon['api_port'] ?? DEFAULTS.apiPort,
        storagePath: daemon['storage_path'] ?? DEFAULTS.storagePath,
        retentionDays: daemon['retention_days'] ?? DEFAULTS.retentionDays,
        budget: {
            orgDailyBudget: daemon['budget']?.['org_daily_budget']
                ?? DEFAULTS.budget.orgDailyBudget,
            perAgentDailyBudget: daemon['budget']?.['per_agent_daily_budget']
                ?? DEFAULTS.budget.perAgentDailyBudget,
            alertThreshold: daemon['budget']?.['alert_threshold']
                ?? DEFAULTS.budget.alertThreshold,
        },
        alerts: {
            dedupWindowMs: daemon['alerts']?.['dedup_window_ms']
                ?? DEFAULTS.alerts.dedupWindowMs,
            webhookUrls: daemon['alerts']?.['webhook_urls']
                ?? DEFAULTS.alerts.webhookUrls,
        },
    };
}
// ── Helpers ──────────────────────────────────────────────────────────────────
function findToml() {
    const candidates = [
        path.join(process.cwd(), 'fuze.toml'),
        path.join(os.homedir(), '.fuze', 'fuze.toml'),
    ];
    for (const p of candidates) {
        if (fs.existsSync(p))
            return p;
    }
    return null;
}
/**
 * Minimal TOML parser — handles only the subset used by fuze.toml.
 * Uses @iarna/toml if available, otherwise falls back to a naive regex parser.
 */
function parseToml(raw) {
    // Try dynamic import-style require for @iarna/toml
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const toml = require('@iarna/toml');
        return toml.parse(raw);
    }
    catch {
        // Fallback: naive section + key=value parser (covers basic fuze.toml needs)
        return naiveToml(raw);
    }
}
function naiveToml(raw) {
    const result = {};
    let current = result;
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#'))
            continue;
        const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/);
        if (sectionMatch) {
            const keys = sectionMatch[1].split('.');
            current = result;
            for (const k of keys) {
                if (!(k in current))
                    current[k] = {};
                current = current[k];
            }
            continue;
        }
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1)
            continue;
        const key = trimmed.slice(0, eqIdx).trim();
        const valRaw = trimmed.slice(eqIdx + 1).trim();
        let value = valRaw;
        if (valRaw === 'true')
            value = true;
        else if (valRaw === 'false')
            value = false;
        else if (/^-?\d+(\.\d+)?$/.test(valRaw))
            value = Number(valRaw);
        else if (valRaw.startsWith('"') && valRaw.endsWith('"'))
            value = valRaw.slice(1, -1);
        else if (valRaw.startsWith("'") && valRaw.endsWith("'"))
            value = valRaw.slice(1, -1);
        else if (valRaw.startsWith('[') && valRaw.endsWith(']')) {
            try {
                value = JSON.parse(valRaw);
            }
            catch {
                value = [];
            }
        }
        current[key] = value;
    }
    return result;
}
//# sourceMappingURL=config.js.map