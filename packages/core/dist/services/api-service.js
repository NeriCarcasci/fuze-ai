const STEP_CHECK_TIMEOUT_MS = 50;
const FLUSH_INTERVAL_MS = 1_000;
const CONFIG_REFRESH_INTERVAL_MS = 30_000;
const MAX_BUFFER_SIZE = 10_000;
/**
 * ApiService — talks to api.fuze-ai.tech (or custom endpoint) over HTTPS.
 *
 * Config: fetches tool configs at connect() time and every 30 seconds.
 * getToolConfig() is synchronous — reads from an in-memory Map.
 *
 * Telemetry: same batched HTTPS strategy as CloudTransport.
 * Step checks use a 50ms timeout, falling back to 'proceed'.
 */
export class ApiService {
    apiKey;
    endpoint;
    _configCache = new Map();
    _buffer = [];
    _flushTimer = null;
    _refreshTimer = null;
    _connected = false;
    constructor(apiKey, endpoint = 'https://api.fuze-ai.tech') {
        this.apiKey = apiKey;
        this.endpoint = endpoint;
    }
    async connect() {
        try {
            const res = await fetch(`${this.endpoint}/v1/health`, {
                headers: { Authorization: `Bearer ${this.apiKey}` },
                signal: AbortSignal.timeout(5_000),
            });
            if (!res.ok)
                return false;
            this._connected = true;
            this._flushTimer = setInterval(() => { void this._flush(); }, FLUSH_INTERVAL_MS);
            this._refreshTimer = setInterval(() => { void this.refreshConfig(); }, CONFIG_REFRESH_INTERVAL_MS);
            // Initial config load — don't fail connect if config fetch fails
            await this.refreshConfig();
            return true;
        }
        catch {
            return false;
        }
    }
    disconnect() {
        if (this._flushTimer) {
            clearInterval(this._flushTimer);
            this._flushTimer = null;
        }
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }
        void this._flush();
        this._connected = false;
    }
    isConnected() { return this._connected; }
    // ── Configuration ──────────────────────────────────────────────────────────
    async registerTools(projectId, tools) {
        try {
            await fetch(`${this.endpoint}/v1/tools/register`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ tools }),
                signal: AbortSignal.timeout(5_000),
            });
        }
        catch {
            // Fire-and-forget — registration failure doesn't block the SDK
        }
    }
    getToolConfig(toolName) {
        return this._configCache.get(toolName) ?? null;
    }
    async refreshConfig() {
        try {
            const res = await fetch(`${this.endpoint}/v1/tools/config`, {
                headers: { Authorization: `Bearer ${this.apiKey}` },
                signal: AbortSignal.timeout(5_000),
            });
            if (!res.ok)
                return;
            const data = await res.json();
            if (data.tools) {
                this._configCache.clear();
                for (const [name, cfg] of Object.entries(data.tools)) {
                    this._configCache.set(name, cfg);
                }
            }
        }
        catch {
            // Keep stale cache — silent failure
        }
    }
    // ── Telemetry ──────────────────────────────────────────────────────────────
    async sendRunStart(runId, agentId, config) {
        this._enqueue({ type: 'run_start', run_id: runId, agent_id: agentId, config });
    }
    async sendStepStart(runId, step) {
        try {
            const res = await fetch(`${this.endpoint}/v1/step/check`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ run_id: runId, step }),
                signal: AbortSignal.timeout(STEP_CHECK_TIMEOUT_MS),
            });
            const body = await res.json();
            const decision = body.decision;
            if (decision === 'kill' || decision === 'pause')
                return decision;
            return 'proceed';
        }
        catch {
            return 'proceed';
        }
    }
    async sendStepEnd(runId, stepId, data) {
        this._enqueue({ type: 'step_end', run_id: runId, step_id: stepId, ...data });
    }
    async sendGuardEvent(runId, event) {
        this._enqueue({ type: 'guard_event', run_id: runId, ...event });
    }
    async sendRunEnd(runId, status, totalCost) {
        this._enqueue({ type: 'run_end', run_id: runId, status, total_cost: totalCost });
        await this._flush();
    }
    // ── Private ────────────────────────────────────────────────────────────────
    _enqueue(event) {
        if (this._buffer.length < MAX_BUFFER_SIZE) {
            this._buffer.push(event);
        }
    }
    async _flush() {
        if (!this._buffer.length)
            return;
        const events = [...this._buffer];
        this._buffer = [];
        try {
            await fetch(`${this.endpoint}/v1/events`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ events }),
            });
        }
        catch {
            if (this._buffer.length + events.length <= MAX_BUFFER_SIZE) {
                this._buffer.unshift(...events);
            }
        }
    }
}
//# sourceMappingURL=api-service.js.map