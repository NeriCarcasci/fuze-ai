import type { DaemonResponse } from './types.js';
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
export declare class DaemonClient {
    private readonly socketPath;
    private socket;
    private buf;
    private pending;
    private reconnectMs;
    private reconnectTimer;
    private closed;
    constructor(socketPath?: string);
    /**
     * Notify the daemon that a run has started.
     * Fire-and-forget.
     */
    notifyRunStart(runId: string, agentId: string, opts?: {
        agentVersion?: string;
        modelProvider?: string;
        modelName?: string;
        config?: Record<string, unknown>;
    }): void;
    /**
     * Notify the daemon that a run has ended.
     * Fire-and-forget.
     */
    notifyRunEnd(runId: string, status: string, totalCost: number): void;
    /**
     * Send step_start to the daemon and wait up to 10 ms for a response.
     *
     * Falls back to { action: 'proceed' } on timeout or disconnection.
     *
     * @returns 'proceed' or 'kill' decision.
     */
    checkStep(runId: string, stepId: string, stepNumber: number, toolName: string, argsHash: string, sideEffect?: boolean): Promise<DaemonResponse>;
    /**
     * Notify the daemon that a step has ended.
     * Fire-and-forget.
     */
    notifyStepEnd(runId: string, stepId: string, costUsd: number, tokensIn: number, tokensOut: number, latencyMs: number, error?: string | null): void;
    /**
     * Notify the daemon of a guard event.
     * Fire-and-forget.
     */
    notifyGuardEvent(runId: string, eventType: string, severity: string, details?: Record<string, unknown>, stepId?: string): void;
    /**
     * Legacy check() kept for backward compatibility.
     * Calls checkStep with defaults.
     */
    check(runId: string, stepId: string): Promise<DaemonResponse>;
    /**
     * Permanently close the connection.
     */
    disconnect(): void;
    private _connect;
    private _send;
    private _onMessage;
    private _resolvePendingWithProceed;
    private _scheduleReconnect;
}
//# sourceMappingURL=daemon-client.d.ts.map