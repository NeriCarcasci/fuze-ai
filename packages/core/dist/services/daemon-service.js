import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
const STEP_TIMEOUT_MS = 10;
const CONFIG_TIMEOUT_MS = 2_000;
const RECONNECT_BASE_MS = 100;
const RECONNECT_MAX_MS = 5_000;
export function getDefaultSocketPath() {
    return process.platform === 'win32'
        ? '\\\\.\\pipe\\fuze-daemon'
        : path.join(os.tmpdir(), 'fuze-daemon.sock');
}
/**
 * DaemonService — talks to the user's local Fuze daemon over UDS / named pipe.
 *
 * Config: sends get_config at connect() time and populates in-memory cache.
 * Step checks use a 10ms timeout, falling back to 'proceed'.
 */
export class DaemonService {
    socketPath;
    _configCache = new Map();
    _socket = null;
    _buf = '';
    _pendingStep = null;
    _pendingConfig = null;
    _reconnectMs = RECONNECT_BASE_MS;
    _reconnectTimer = null;
    _closed = false;
    _connected = false;
    constructor(socketPath = getDefaultSocketPath()) {
        this.socketPath = socketPath;
    }
    async connect() {
        this._connect();
        // Wait briefly for initial connection
        await new Promise(resolve => setTimeout(resolve, 50));
        if (this._connected) {
            await this.refreshConfig();
        }
        return this._connected;
    }
    disconnect() {
        this._closed = true;
        if (this._reconnectTimer)
            clearTimeout(this._reconnectTimer);
        if (this._socket) {
            this._socket.destroy();
            this._socket = null;
        }
        this._connected = false;
    }
    isConnected() { return this._connected; }
    // ── Configuration ──────────────────────────────────────────────────────────
    async registerTools(projectId, tools) {
        this._send({ type: 'register_tools', projectId, tools });
    }
    getToolConfig(toolName) {
        return this._configCache.get(toolName) ?? null;
    }
    async refreshConfig() {
        if (!this._socket || this._socket.destroyed)
            return;
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this._pendingConfig = null;
                resolve();
            }, CONFIG_TIMEOUT_MS);
            this._pendingConfig = {
                resolve: (tools) => {
                    this._configCache.clear();
                    for (const [name, cfg] of Object.entries(tools)) {
                        this._configCache.set(name, cfg);
                    }
                    resolve();
                },
                reject: () => resolve(),
                timer,
            };
            const sent = this._send({ type: 'get_config' });
            if (!sent) {
                clearTimeout(timer);
                this._pendingConfig = null;
                resolve();
            }
        });
    }
    // ── Telemetry ──────────────────────────────────────────────────────────────
    async sendRunStart(runId, agentId, _config) {
        this._send({ type: 'run_start', runId, agentId });
    }
    async sendStepStart(runId, step) {
        if (!this._socket || this._socket.destroyed)
            return 'proceed';
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this._pendingStep = null;
                resolve('proceed');
            }, STEP_TIMEOUT_MS);
            this._pendingStep = { resolve, timer };
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
                this._pendingStep = null;
                resolve('proceed');
            }
        });
    }
    async sendStepEnd(runId, stepId, data) {
        this._send({ type: 'step_end', runId, stepId, ...data, error: data.error ?? null });
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
    // ── Private ────────────────────────────────────────────────────────────────
    _connect() {
        if (this._closed)
            return;
        const sock = net.createConnection(this.socketPath);
        this._socket = sock;
        this._buf = '';
        sock.on('connect', () => {
            this._connected = true;
            this._reconnectMs = RECONNECT_BASE_MS;
        });
        sock.on('data', (chunk) => {
            this._buf += chunk.toString('utf8');
            const lines = this._buf.split('\n');
            this._buf = lines.pop() ?? '';
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed)
                    this._onMessage(trimmed);
            }
        });
        sock.on('error', () => { });
        sock.on('close', () => {
            this._socket = null;
            this._connected = false;
            this._resolvePendingStepWithProceed();
            this._scheduleReconnect();
        });
    }
    _send(msg) {
        if (!this._socket || this._socket.destroyed)
            return false;
        try {
            this._socket.write(JSON.stringify(msg) + '\n');
            return true;
        }
        catch {
            return false;
        }
    }
    _onMessage(line) {
        try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'config' && this._pendingConfig) {
                const { resolve, timer } = this._pendingConfig;
                this._pendingConfig = null;
                clearTimeout(timer);
                resolve(parsed.tools ?? {});
                return;
            }
            if (this._pendingStep) {
                const { resolve, timer } = this._pendingStep;
                this._pendingStep = null;
                clearTimeout(timer);
                if (parsed.type === 'kill')
                    resolve('kill');
                else if (parsed.type === 'pause')
                    resolve('pause');
                else
                    resolve('proceed');
            }
        }
        catch {
            this._resolvePendingStepWithProceed();
        }
    }
    _resolvePendingStepWithProceed() {
        if (!this._pendingStep)
            return;
        const { resolve, timer } = this._pendingStep;
        this._pendingStep = null;
        clearTimeout(timer);
        resolve('proceed');
    }
    _scheduleReconnect() {
        if (this._closed)
            return;
        this._reconnectTimer = setTimeout(() => {
            this._reconnectMs = Math.min(this._reconnectMs * 2, RECONNECT_MAX_MS);
            this._connect();
        }, this._reconnectMs);
    }
}
//# sourceMappingURL=daemon-service.js.map