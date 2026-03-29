const STEP_CHECK_TIMEOUT_MS = 50; // Never block the agent more than 50ms
const FLUSH_INTERVAL_MS = 1_000;
const MAX_BUFFER_SIZE = 10_000;
/**
 * CloudTransport — sends telemetry to api.fuze-ai.tech over HTTPS.
 *
 * Step checks (sendStepStart) are synchronous with a 50ms timeout — the agent
 * never blocks for longer regardless of cloud latency.
 *
 * Everything else is batched in memory and flushed every second (or immediately
 * on sendRunEnd). Events are never lost unless the buffer exceeds 10K entries.
 */
export class CloudTransport {
    apiKey;
    endpoint;
    buffer = [];
    flushTimer = null;
    _connected = false;
    constructor(apiKey, endpoint = 'https://api.fuze-ai.tech') {
        this.apiKey = apiKey;
        this.endpoint = endpoint;
    }
    async connect() {
        try {
            const res = await fetch(`${this.endpoint}/v1/health`, {
                headers: { Authorization: `Bearer ${this.apiKey}` },
            });
            if (res.ok) {
                this._connected = true;
                this.flushTimer = setInterval(() => { void this._flush(); }, FLUSH_INTERVAL_MS);
                return true;
            }
            return false;
        }
        catch {
            return false;
        }
    }
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
            // Never block the agent if cloud is slow or down
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
    isConnected() { return this._connected; }
    disconnect() {
        if (this.flushTimer) {
            clearInterval(this.flushTimer);
            this.flushTimer = null;
        }
        void this._flush();
        this._connected = false;
    }
    // ── Private ──────────────────────────────────────────────────────────────────
    _enqueue(event) {
        if (this.buffer.length < MAX_BUFFER_SIZE) {
            this.buffer.push(event);
        }
    }
    async _flush() {
        if (!this.buffer.length)
            return;
        const events = [...this.buffer];
        this.buffer = [];
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
            // Re-queue failed events (up to buffer limit)
            if (this.buffer.length + events.length <= MAX_BUFFER_SIZE) {
                this.buffer.unshift(...events);
            }
        }
    }
}
//# sourceMappingURL=cloud.js.map