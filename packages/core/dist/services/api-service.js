const STEP_CHECK_TIMEOUT_MS = 50;
const DEFAULT_FLUSH_INTERVAL_MS = 5_000;
const MIN_FLUSH_INTERVAL_MS = 1_000;
const CONFIG_REFRESH_INTERVAL_MS = 30_000;
const CONFIG_CACHE_TTL_MS = 5 * 60_000;
const MAX_BUFFER_SIZE = 10_000;
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3;
const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000;
const FLUSH_BACKOFF_MIN_MS = 1_000;
const FLUSH_BACKOFF_MAX_MS = 30_000;
/**
 * ApiService talks to api.fuze-ai.tech (or custom endpoint) over HTTPS.
 */
export class ApiService {
    apiKey;
    _configCache = new Map();
    _endpoint;
    _flushIntervalMs;
    _buffer = [];
    _flushTimer = null;
    _refreshTimer = null;
    _connected = false;
    _configRefreshedAt = 0;
    _consecutiveFailures = 0;
    _circuitOpenUntil = 0;
    _probeInFlight = false;
    _flushBackoffMs = FLUSH_BACKOFF_MIN_MS;
    _nextFlushAt = 0;
    _beforeExitHandler = null;
    constructor(apiKey, options = {}) {
        this.apiKey = apiKey;
        this._endpoint = options.endpoint ?? 'https://api.fuze-ai.tech';
        const requested = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
        this._flushIntervalMs = Math.max(MIN_FLUSH_INTERVAL_MS, requested);
    }
    async connect() {
        if (!this._hasApiKey()) {
            this._connected = false;
            return false;
        }
        const healthy = await this._request(async () => {
            const res = await fetch(`${this._endpoint}/v1/health`, {
                headers: { Authorization: `Bearer ${this.apiKey}` },
                signal: AbortSignal.timeout(5_000),
            });
            if (!res.ok)
                throw new Error(`Health check failed: ${res.status}`);
        });
        if (healthy === null) {
            this._connected = false;
            return false;
        }
        this._connected = true;
        this._flushTimer = setInterval(() => {
            this._runInBackground(this._flushTick());
        }, this._flushIntervalMs);
        this._refreshTimer = setInterval(() => {
            this._runInBackground(this.refreshConfig());
        }, CONFIG_REFRESH_INTERVAL_MS);
        if (!this._beforeExitHandler) {
            this._beforeExitHandler = () => {
                this._runInBackground(this.flush());
            };
            process.once('beforeExit', this._beforeExitHandler);
        }
        await this.refreshConfig(true);
        return true;
    }
    async disconnect() {
        if (this._flushTimer) {
            clearInterval(this._flushTimer);
            this._flushTimer = null;
        }
        if (this._refreshTimer) {
            clearInterval(this._refreshTimer);
            this._refreshTimer = null;
        }
        if (this._beforeExitHandler) {
            process.off('beforeExit', this._beforeExitHandler);
            this._beforeExitHandler = null;
        }
        await this.flush();
        this._connected = false;
    }
    isConnected() {
        return this._connected && !this._isCircuitOpen(Date.now()) && this._hasApiKey();
    }
    async flush() {
        await this._flushInternal(true);
    }
    async registerTools(projectId, tools) {
        if (!this._hasApiKey())
            return;
        await this._request(async () => {
            const res = await fetch(`${this._endpoint}/v1/tools/register`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ project_id: projectId, tools }),
                signal: AbortSignal.timeout(5_000),
            });
            if (!res.ok)
                throw new Error(`Tool registration failed: ${res.status}`);
        });
    }
    getToolConfig(toolName) {
        return this._configCache.get(toolName) ?? null;
    }
    async refreshConfig(force = false) {
        if (!this._hasApiKey())
            return;
        const now = Date.now();
        if (!force && this._configRefreshedAt > 0 && now - this._configRefreshedAt < CONFIG_CACHE_TTL_MS) {
            return;
        }
        const data = await this._request(async () => {
            const res = await fetch(`${this._endpoint}/v1/tools/config`, {
                headers: { Authorization: `Bearer ${this.apiKey}` },
                signal: AbortSignal.timeout(5_000),
            });
            if (!res.ok)
                throw new Error(`Config refresh failed: ${res.status}`);
            return await res.json();
        });
        if (!data?.tools || typeof data.tools !== 'object')
            return;
        this._configCache.clear();
        for (const [name, cfg] of Object.entries(data.tools)) {
            this._configCache.set(name, cfg);
        }
        this._configRefreshedAt = Date.now();
    }
    async sendRunStart(runId, agentId, config) {
        this._enqueue({ type: 'run_start', run_id: runId, agent_id: agentId, config });
    }
    async sendStepStart(runId, step) {
        if (!this._hasApiKey())
            return 'proceed';
        const body = await this._request(async () => {
            const res = await fetch(`${this._endpoint}/v1/step/check`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ run_id: runId, step }),
                signal: AbortSignal.timeout(STEP_CHECK_TIMEOUT_MS),
            });
            if (!res.ok)
                throw new Error(`Step check failed: ${res.status}`);
            return await res.json();
        });
        const decision = body?.decision;
        if (decision === 'kill' || decision === 'pause')
            return decision;
        return 'proceed';
    }
    async sendStepEnd(runId, stepId, data) {
        this._enqueue({ type: 'step_end', run_id: runId, step_id: stepId, ...data });
    }
    async sendGuardEvent(runId, event) {
        this._enqueue({ type: 'guard_event', run_id: runId, ...event });
    }
    async sendRunEnd(runId, status) {
        this._enqueue({ type: 'run_end', run_id: runId, status });
        await this.flush();
    }
    _enqueue(event) {
        if (!this._hasApiKey())
            return;
        if (this._buffer.length < MAX_BUFFER_SIZE) {
            this._buffer.push(event);
        }
    }
    async _flushTick() {
        await this._flushInternal(false);
    }
    async _flushInternal(force) {
        if (!this._buffer.length)
            return true;
        if (!this._hasApiKey())
            return true;
        if (!force && Date.now() < this._nextFlushAt)
            return false;
        const events = [...this._buffer];
        this._buffer = [];
        const sent = await this._request(async () => {
            const res = await fetch(`${this._endpoint}/v1/events`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ events }),
            });
            if (!res.ok)
                throw new Error(`Event flush failed: ${res.status}`);
        });
        if (sent !== null) {
            this._flushBackoffMs = FLUSH_BACKOFF_MIN_MS;
            this._nextFlushAt = 0;
            return true;
        }
        if (this._buffer.length + events.length <= MAX_BUFFER_SIZE) {
            this._buffer.unshift(...events);
        }
        this._nextFlushAt = Date.now() + this._flushBackoffMs;
        this._flushBackoffMs = Math.min(this._flushBackoffMs * 2, FLUSH_BACKOFF_MAX_MS);
        return false;
    }
    _hasApiKey() {
        return this.apiKey.trim().length > 0;
    }
    _isCircuitOpen(now) {
        return this._circuitOpenUntil > now;
    }
    _isHalfOpen(now) {
        return this._circuitOpenUntil !== 0 && now >= this._circuitOpenUntil;
    }
    _onRequestSuccess() {
        this._consecutiveFailures = 0;
        this._circuitOpenUntil = 0;
    }
    _onRequestFailure() {
        this._consecutiveFailures += 1;
        if (this._consecutiveFailures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
            this._consecutiveFailures = CIRCUIT_BREAKER_FAILURE_THRESHOLD;
            this._circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS;
        }
    }
    async _request(operation) {
        if (!this._hasApiKey())
            return null;
        const now = Date.now();
        if (this._isCircuitOpen(now))
            return null;
        const isProbe = this._isHalfOpen(now);
        if (isProbe && this._probeInFlight)
            return null;
        if (isProbe)
            this._probeInFlight = true;
        try {
            const value = await operation();
            this._onRequestSuccess();
            return value;
        }
        catch {
            this._onRequestFailure();
            return null;
        }
        finally {
            if (isProbe)
                this._probeInFlight = false;
        }
    }
    _runInBackground(task) {
        task.catch(() => undefined);
    }
}
//# sourceMappingURL=api-service.js.map