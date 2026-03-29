import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
const STEP_TIMEOUT_MS = 10;
const RECONNECT_BASE_MS = 100;
const RECONNECT_MAX_MS = 5_000;
export function getDefaultSocketPath() {
    return process.platform === 'win32'
        ? '\\\\.\\pipe\\fuze-daemon'
        : path.join(os.tmpdir(), 'fuze-daemon.sock');
}
/**
 * SocketTransport — talks to the user's local Fuze daemon over a Unix Domain Socket
 * (or Windows named pipe). Falls back to 'proceed' within 10ms if the daemon is
 * unavailable so the agent is never blocked by a dead socket.
 */
export class SocketTransport {
    socketPath;
    socket = null;
    buf = '';
    pending = null;
    reconnectMs = RECONNECT_BASE_MS;
    reconnectTimer = null;
    closed = false;
    connected = false;
    constructor(socketPath = getDefaultSocketPath()) {
        this.socketPath = socketPath;
        this._connect();
    }
    async connect() {
        // Connection is initiated in constructor; this is a no-op status check
        return this.connected;
    }
    async sendRunStart(runId, agentId, _config) {
        this._send({ type: 'run_start', runId, agentId });
    }
    async sendStepStart(runId, step) {
        if (!this.socket || this.socket.destroyed)
            return 'proceed';
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.pending = null;
                resolve('proceed');
            }, STEP_TIMEOUT_MS);
            this.pending = { resolve, timer };
            const sent = this._send({
                type: 'step_start',
                runId,
                stepId: step.stepId,
                stepNumber: step.stepNumber,
                toolName: step.toolName,
                argsHash: step.argsHash,
                sideEffect: step.sideEffect,
            });
            if (!sent) {
                clearTimeout(timer);
                this.pending = null;
                resolve('proceed');
            }
        });
    }
    async sendStepEnd(runId, stepId, data) {
        this._send({
            type: 'step_end',
            runId,
            stepId,
            costUsd: data.costUsd,
            tokensIn: data.tokensIn,
            tokensOut: data.tokensOut,
            latencyMs: data.latencyMs,
            error: data.error ?? null,
        });
    }
    async sendGuardEvent(runId, event) {
        this._send({
            type: 'guard_event',
            runId,
            stepId: event.stepId,
            eventType: event.eventType,
            severity: event.severity,
            details: event.details,
        });
    }
    async sendRunEnd(runId, status, totalCost) {
        this._send({ type: 'run_end', runId, status, totalCost });
    }
    isConnected() { return this.connected; }
    disconnect() {
        this.closed = true;
        if (this.reconnectTimer)
            clearTimeout(this.reconnectTimer);
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
        this.connected = false;
    }
    // ── Private ──────────────────────────────────────────────────────────────────
    _connect() {
        if (this.closed)
            return;
        const sock = net.createConnection(this.socketPath);
        this.socket = sock;
        this.buf = '';
        sock.on('connect', () => {
            this.connected = true;
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
            // Handled by 'close'
        });
        sock.on('close', () => {
            this.socket = null;
            this.connected = false;
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
                resolve('kill');
            }
            else if (parsed.type === 'pause') {
                resolve('pause');
            }
            else {
                resolve('proceed');
            }
        }
        catch {
            this._resolvePendingWithProceed();
        }
    }
    _resolvePendingWithProceed() {
        if (!this.pending)
            return;
        const { resolve, timer } = this.pending;
        this.pending = null;
        clearTimeout(timer);
        resolve('proceed');
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
//# sourceMappingURL=socket.js.map