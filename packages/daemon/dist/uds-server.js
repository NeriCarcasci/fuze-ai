import * as net from 'node:net';
import * as fs from 'node:fs';
import { parseMessage, serialiseResponse, PROCEED } from './protocol.js';
const MAX_BUFFER_BYTES = 1_048_576;
const DISPATCH_TIMEOUT_MS = 30_000;
/**
 * Unix Domain Socket server for SDK ↔ Daemon communication.
 *
 * Accepts JSON-over-newline messages from SDK clients, routes them through
 * RunManager / BudgetEnforcer / AuditStore, and writes back DaemonResponse.
 */
export class UDSServer {
    socketPath;
    deps;
    server;
    connections = new Set();
    /** stepId → step metadata buffered between step_start and step_end */
    pendingSteps = new Map();
    /** Set after construction to broadcast run/step events to WebSocket clients. */
    onEvent;
    constructor(socketPath, deps) {
        this.socketPath = socketPath;
        this.deps = deps;
    }
    /**
     * Start listening on the socket path.
     * Removes any stale socket file before binding.
     */
    async start() {
        // Clean up stale socket (Unix only; Windows named pipes don't leave files)
        if (process.platform !== 'win32' && fs.existsSync(this.socketPath)) {
            fs.unlinkSync(this.socketPath);
        }
        return new Promise((resolve, reject) => {
            this.server = net.createServer((socket) => this._onConnection(socket));
            this.server.on('error', reject);
            this.server.listen(this.socketPath, () => resolve());
        });
    }
    /**
     * Stop the server and close all active connections.
     */
    async stop() {
        for (const socket of this.connections) {
            socket.destroy();
        }
        this.connections.clear();
        return new Promise((resolve, reject) => {
            this.server.close((err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    /** Returns the number of currently connected clients. */
    get connectionCount() {
        return this.connections.size;
    }
    // ── Private ──────────────────────────────────────────────────────────────
    _onConnection(socket) {
        this.connections.add(socket);
        let buf = '';
        socket.on('data', (chunk) => {
            buf += chunk.toString('utf8');
            if (Buffer.byteLength(buf, 'utf8') > MAX_BUFFER_BYTES) {
                process.stderr.write('[fuze-daemon] Warning: closing socket due to oversized UDS message buffer (>1MB)\n');
                socket.destroy();
                return;
            }
            const lines = buf.split('\n');
            buf = lines.pop() ?? ''; // keep partial last line
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed)
                    continue;
                this._handleLine(socket, trimmed);
            }
        });
        socket.on('close', () => {
            this.connections.delete(socket);
        });
        socket.on('error', () => {
            this.connections.delete(socket);
        });
    }
    _handleLine(socket, line) {
        let msg;
        try {
            msg = parseMessage(line);
        }
        catch (err) {
            // Malformed JSON or unknown type — log and ignore (no response needed)
            this.deps.alertManager.emit({
                type: 'protocol_error',
                severity: 'warning',
                message: err.message,
                details: { raw: line.slice(0, 200) },
            });
            return;
        }
        // Dispatch and write response (async, fire-and-forget; errors caught internally)
        this._dispatchWithTimeout(msg).then((response) => {
            if (response !== null) {
                try {
                    socket.write(serialiseResponse(response));
                }
                catch {
                    // socket may have closed between dispatch and write
                }
            }
        }, (err) => {
            this.deps.alertManager.emit({
                type: 'dispatch_error',
                severity: 'warning',
                message: err.message,
                details: { msgType: msg.type },
            });
        });
    }
    async _dispatchWithTimeout(msg) {
        let timeout;
        const timeoutPromise = new Promise((resolve) => {
            timeout = setTimeout(() => {
                resolve({ type: 'error', message: 'dispatch_timeout' });
            }, DISPATCH_TIMEOUT_MS);
        });
        const response = await Promise.race([
            this._dispatch(msg),
            timeoutPromise,
        ]);
        if (timeout) {
            clearTimeout(timeout);
        }
        if (response !== null && response.type === 'error' && response.message === 'dispatch_timeout') {
            process.stderr.write(`[fuze-daemon] Warning: dispatch timed out after ${DISPATCH_TIMEOUT_MS}ms for message type '${msg.type}'\n`);
        }
        return response;
    }
    async _dispatch(msg) {
        const { runManager, budgetEnforcer, patternAnalyser, auditStore, alertManager } = this.deps;
        switch (msg.type) {
            case 'run_start': {
                const startedAt = new Date().toISOString();
                runManager.startRun(msg.runId, msg.agentId, msg.config ?? {}, {
                    agentVersion: msg.agentVersion,
                    modelProvider: msg.modelProvider,
                    modelName: msg.modelName,
                });
                await auditStore.insertRun({
                    runId: msg.runId,
                    agentId: msg.agentId,
                    agentVersion: msg.agentVersion ?? '',
                    modelProvider: msg.modelProvider ?? '',
                    modelName: msg.modelName ?? '',
                    status: 'running',
                    startedAt,
                    endedAt: undefined,
                    totalCost: 0,
                    totalTokensIn: 0,
                    totalTokensOut: 0,
                    totalSteps: 0,
                    configJson: JSON.stringify(msg.config ?? {}),
                });
                this.onEvent?.('run_start', { runId: msg.runId, agentId: msg.agentId, startedAt });
                return null; // no response for run_start
            }
            case 'run_end': {
                runManager.endRun(msg.runId, msg.status, msg.totalCost);
                const endedAt = new Date().toISOString();
                await auditStore.updateRunStatus(msg.runId, msg.status, msg.totalCost, endedAt);
                // Feed pattern analyser with outcome
                const run = runManager.getRun(msg.runId);
                if (run) {
                    const lastFailedStep = [...run.steps].reverse().find((s) => s.toolName);
                    patternAnalyser.recordRunOutcome(run.agentId, msg.status, lastFailedStep?.stepId, msg.status !== 'completed' ? lastFailedStep?.toolName : undefined, msg.totalCost);
                    const alerts = patternAnalyser.analyse();
                    for (const alert of alerts) {
                        alertManager.emit({
                            type: alert.type,
                            severity: alert.severity,
                            message: `Pattern alert for agent ${alert.agentId}: ${alert.type}`,
                            details: alert.details,
                        });
                    }
                }
                this.onEvent?.('run_end', { runId: msg.runId, status: msg.status, totalCost: msg.totalCost, endedAt });
                return null;
            }
            case 'step_start': {
                const agentId = runManager.getRun(msg.runId)?.agentId ?? msg.runId;
                // Budget check before executing step
                const decision = budgetEnforcer.checkBudget(agentId, 0);
                if (decision?.action === 'kill') {
                    runManager.killRun(msg.runId, decision.reason);
                    await auditStore.updateRunStatus(msg.runId, 'budget_exceeded', 0);
                    alertManager.emit({
                        type: 'budget_exceeded',
                        severity: 'action',
                        message: decision.reason,
                        details: { runId: msg.runId },
                    });
                    return { type: 'kill', reason: decision.reason, message: decision.reason };
                }
                // Buffer step metadata for later use in step_end
                const idempotencyKey = this.deps.idempotencyManager?.generateKey(msg.runId, msg.toolName, msg.argsHash);
                if (idempotencyKey && await this.deps.idempotencyManager?.check(idempotencyKey)) {
                    return { type: 'retry', context: 'duplicate_step' };
                }
                this.pendingSteps.set(msg.stepId, {
                    stepNumber: msg.stepNumber,
                    toolName: msg.toolName,
                    argsHash: msg.argsHash,
                    sideEffect: msg.sideEffect,
                    startedAt: new Date().toISOString(),
                    idempotencyKey,
                });
                return PROCEED;
            }
            case 'step_end': {
                const pending = this.pendingSteps.get(msg.stepId);
                this.pendingSteps.delete(msg.stepId);
                const run = runManager.getRun(msg.runId);
                const agentId = run?.agentId ?? msg.runId;
                // Record actual spend
                budgetEnforcer.recordSpend(agentId, msg.costUsd);
                // Alert if at budget threshold
                if (budgetEnforcer.isAtAlertThreshold()) {
                    alertManager.emit({
                        type: 'budget_threshold',
                        severity: 'warning',
                        message: `Org budget alert threshold reached`,
                        details: budgetEnforcer.getOrgSpend(),
                    });
                }
                // Record step in RunManager
                if (pending) {
                    runManager.recordStep(msg.runId, {
                        stepId: msg.stepId,
                        stepNumber: pending.stepNumber,
                        toolName: pending.toolName,
                        argsHash: pending.argsHash,
                        sideEffect: pending.sideEffect,
                        startedAt: pending.startedAt,
                        costUsd: msg.costUsd,
                    });
                }
                if (pending?.idempotencyKey) {
                    await this.deps.idempotencyManager?.recordExecution(pending.idempotencyKey, msg.runId, msg.stepId, pending.toolName, pending.argsHash, {
                        costUsd: msg.costUsd,
                        tokensIn: msg.tokensIn,
                        tokensOut: msg.tokensOut,
                        latencyMs: msg.latencyMs,
                        error: msg.error ?? null,
                    });
                }
                // Persist step to audit store
                const stepEndedAt = new Date().toISOString();
                await auditStore.insertStep({
                    stepId: msg.stepId,
                    runId: msg.runId,
                    stepNumber: pending?.stepNumber ?? 0,
                    startedAt: pending?.startedAt ?? new Date().toISOString(),
                    endedAt: stepEndedAt,
                    toolName: pending?.toolName ?? '',
                    argsHash: pending?.argsHash ?? '',
                    hasSideEffect: pending?.sideEffect ? 1 : 0,
                    costUsd: msg.costUsd,
                    tokensIn: msg.tokensIn,
                    tokensOut: msg.tokensOut,
                    latencyMs: msg.latencyMs,
                    error: msg.error ?? null,
                });
                this.onEvent?.('step_end', {
                    runId: msg.runId,
                    stepId: msg.stepId,
                    toolName: pending?.toolName ?? '',
                    costUsd: msg.costUsd,
                    latencyMs: msg.latencyMs,
                    error: msg.error ?? null,
                    endedAt: stepEndedAt,
                });
                return null;
            }
            case 'guard_event': {
                const eventId = `ge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                runManager.recordGuardEvent(msg.runId, {
                    eventId,
                    stepId: msg.stepId,
                    eventType: msg.eventType,
                    severity: msg.severity,
                    details: msg.details,
                });
                await auditStore.insertGuardEvent({
                    eventId,
                    runId: msg.runId,
                    stepId: msg.stepId,
                    timestamp: new Date().toISOString(),
                    eventType: msg.eventType,
                    severity: msg.severity,
                    detailsJson: JSON.stringify(msg.details),
                });
                if (msg.severity === 'critical' || msg.severity === 'action') {
                    alertManager.emit({
                        type: msg.eventType,
                        severity: msg.severity,
                        message: `Guard event: ${msg.eventType}`,
                        details: { runId: msg.runId, ...msg.details },
                    });
                }
                this.onEvent?.('guard_event', {
                    runId: msg.runId,
                    stepId: msg.stepId,
                    eventType: msg.eventType,
                    severity: msg.severity,
                    details: msg.details,
                });
                return null;
            }
            case 'register_tools': {
                // Populate cache with default configs for any tool not already cached.
                // This lets local (no-cloud) users still benefit from per-tool limits
                // that they registered at SDK boot time.
                const { configCache } = this.deps;
                if (configCache) {
                    for (const tool of msg.tools) {
                        configCache.upsertToolConfig(msg.projectId, tool.name, {
                            maxRetries: tool.defaults?.maxRetries ?? 3,
                            maxBudget: tool.defaults?.maxBudget ?? 1.0,
                            timeout: tool.defaults?.timeout ?? 30000,
                            enabled: true,
                            updatedAt: new Date().toISOString(),
                        });
                    }
                }
                return null;
            }
            case 'get_config': {
                const tools = this.deps.configCache?.getAllToolConfigs() ?? {};
                return { type: 'config', tools };
            }
            default:
                return null;
        }
    }
}
//# sourceMappingURL=uds-server.js.map