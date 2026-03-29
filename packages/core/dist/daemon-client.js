import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
const DEFAULT_SOCKET = process.platform === 'win32'
    ? '\\\\.\\pipe\\fuze-daemon'
    : path.join(os.tmpdir(), 'fuze-daemon.sock');
const STEP_TIMEOUT_MS = 10;
const RECONNECT_BASE_MS = 100;
const RECONNECT_MAX_MS = 5_000;
/**
 * UDS client for the Fuze runtime daemon.
 *
 * Sends SDK → Daemon messages over a Unix Domain Socket using the
 * JSON-over-newline protocol. step_start waits up to 10 ms for a daemon
 * response; on timeout or disconnection the client falls back to 'proceed'
 * so that the agent is never blocked by a dead daemon.
 *
 * All other message types (run_start, run_end, step_end, guard_event) are
 * fire-and-forget.
 */
export class DaemonClient {
    socketPath;
    socket = null;
    buf = '';
    pending = null;
    reconnectMs = RECONNECT_BASE_MS;
    reconnectTimer = null;
    closed = false;
    constructor(socketPath = DEFAULT_SOCKET) {
        this.socketPath = socketPath;
        this._connect();
    }
    // ── Public API ────────────────────────────────────────────────────────────
    /**
     * Notify the daemon that a run has started.
     * Fire-and-forget.
     */
    notifyRunStart(runId, agentId, opts = {}) {
        this._send({
            type: 'run_start',
            runId,
            agentId,
            ...opts,
        });
    }
    /**
     * Notify the daemon that a run has ended.
     * Fire-and-forget.
     */
    notifyRunEnd(runId, status, totalCost) {
        this._send({
            type: 'run_end',
            runId,
            status,
            totalCost,
        });
    }
    /**
     * Send step_start to the daemon and wait up to 10 ms for a response.
     *
     * Falls back to { action: 'proceed' } on timeout or disconnection.
     *
     * @returns 'proceed' or 'kill' decision.
     */
    async checkStep(runId, stepId, stepNumber, toolName, argsHash, sideEffect = false) {
        if (!this.socket || this.socket.destroyed) {
            return { action: 'proceed' };
        }
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pending = null;
                resolve({ action: 'proceed' });
            }, STEP_TIMEOUT_MS);
            this.pending = { resolve, timer };
            const sent = this._send({
                type: 'step_start',
                runId,
                stepId,
                stepNumber,
                toolName,
                argsHash,
                sideEffect,
            });
            if (!sent) {
                clearTimeout(timer);
                this.pending = null;
                resolve({ action: 'proceed' });
            }
        });
    }
    /**
     * Notify the daemon that a step has ended.
     * Fire-and-forget.
     */
    notifyStepEnd(runId, stepId, costUsd, tokensIn, tokensOut, latencyMs, error) {
        this._send({
            type: 'step_end',
            runId,
            stepId,
            costUsd,
            tokensIn,
            tokensOut,
            latencyMs,
            error,
        });
    }
    /**
     * Notify the daemon of a guard event.
     * Fire-and-forget.
     */
    notifyGuardEvent(runId, eventType, severity, details = {}, stepId) {
        this._send({
            type: 'guard_event',
            runId,
            stepId,
            eventType,
            severity,
            details,
        });
    }
    /**
     * Legacy check() kept for backward compatibility.
     * Calls checkStep with defaults.
     */
    async check(runId, stepId) {
        return this.checkStep(runId, stepId, 0, 'unknown', '0'.repeat(16));
    }
    /**
     * Permanently close the connection.
     */
    disconnect() {
        this.closed = true;
        if (this.reconnectTimer)
            clearTimeout(this.reconnectTimer);
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
    }
    // ── Private ───────────────────────────────────────────────────────────────
    _connect() {
        if (this.closed)
            return;
        const sock = net.createConnection(this.socketPath);
        this.socket = sock;
        this.buf = '';
        sock.on('connect', () => {
            this.reconnectMs = RECONNECT_BASE_MS;
        });
        sock.on('data', (chunk) => {
            this.buf += chunk.toString('utf8');
            const lines = this.buf.split('\n');
            this.buf = lines.pop() ?? '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed)
                    this._onMessage(trimmed);
            }
        });
        sock.on('error', () => {
            // Error is handled by 'close'
        });
        sock.on('close', () => {
            this.socket = null;
            this._resolvePendingWithProceed();
            this._scheduleReconnect();
        });
    }
    _send(msg) {
        if (!this.socket || this.socket.destroyed)
            return false;
        try {
            this.socket.write(JSON.stringify(msg) + '\n');
            return true;
        }
        catch {
            return false;
        }
    }
    _onMessage(line) {
        if (!this.pending)
            return;
        try {
            const parsed = JSON.parse(line);
            const { resolve, timer } = this.pending;
            this.pending = null;
            clearTimeout(timer);
            if (parsed.type === 'kill') {
                resolve({ action: 'kill', reason: parsed.reason ?? parsed.message });
            }
            else if (parsed.type === 'pause') {
                resolve({ action: 'pause', reason: parsed.reason });
            }
            else {
                resolve({ action: 'proceed' });
            }
        }
        catch {
            // Malformed response — proceed
            this._resolvePendingWithProceed();
        }
    }
    _resolvePendingWithProceed() {
        if (!this.pending)
            return;
        const { resolve, timer } = this.pending;
        this.pending = null;
        clearTimeout(timer);
        resolve({ action: 'proceed' });
    }
    _scheduleReconnect() {
        if (this.closed)
            return;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectMs = Math.min(this.reconnectMs * 2, RECONNECT_MAX_MS);
            this._connect();
        }, this.reconnectMs);
    }
}
//# sourceMappingURL=daemon-client.js.map