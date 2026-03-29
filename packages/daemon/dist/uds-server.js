import * as net from 'node:net';
import * as fs from 'node:fs';
import { parseMessage, serialiseResponse, PROCEED } from './protocol.js';
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
        this._dispatch(msg).then((response) => {
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
    async _dispatch(msg) {
        const { runManager, budgetEnforcer, patternAnalyser, auditStore, alertManager } = this.deps;
        switch (msg.type) {
            case 'run_start': {
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
                    startedAt: new Date().toISOString(),
                    endedAt: undefined,
                    totalCost: 0,
                    totalTokensIn: 0,
                    totalTokensOut: 0,
                    totalSteps: 0,
                    configJson: JSON.stringify(msg.config ?? {}),
                });
                return null; // no response for run_start
            }
            case 'run_end': {
                runManager.endRun(msg.runId, msg.status, msg.totalCost);
                await auditStore.updateRunStatus(msg.runId, msg.status, msg.totalCost, new Date().toISOString());
                // Feed pattern analyser with outcome
                const run = runManager.getRun(msg.runId);
                if (run) {
                    const lastFailedStep = [...run.steps].reverse().find((s) => s.toolName);
                    patternAnalyser.recordRunOutcome(run.agentId, msg.status, lastFailedStep?.toolName, msg.status !== 'completed' ? lastFailedStep?.toolName : undefined, msg.totalCost);
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
                this.pendingSteps.set(msg.stepId, {
                    stepNumber: msg.stepNumber,
                    toolName: msg.toolName,
                    argsHash: msg.argsHash,
                    sideEffect: msg.sideEffect,
                    startedAt: new Date().toISOString(),
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
                // Persist step to audit store
                await auditStore.insertStep({
                    stepId: msg.stepId,
                    runId: msg.runId,
                    stepNumber: pending?.stepNumber ?? 0,
                    startedAt: pending?.startedAt ?? new Date().toISOString(),
                    endedAt: new Date().toISOString(),
                    toolName: pending?.toolName ?? '',
                    argsHash: pending?.argsHash ?? '',
                    hasSideEffect: pending?.sideEffect ? 1 : 0,
                    costUsd: msg.costUsd,
                    tokensIn: msg.tokensIn,
                    tokensOut: msg.tokensOut,
                    latencyMs: msg.latencyMs,
                    error: msg.error ?? null,
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
                return null;
            }
            default:
                return null;
        }
    }
}
//# sourceMappingURL=uds-server.js.map