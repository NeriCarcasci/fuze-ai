import type { RunManager } from './run-manager.js';
import type { BudgetEnforcer } from './budget-enforcer.js';
import type { PatternAnalyser } from './pattern-analyser.js';
import type { AuditStore } from './audit-store.js';
import type { AlertManager } from './alert-manager.js';
import type { ConfigCache } from './config-cache.js';
import type { IdempotencyManager } from './compensation/idempotency.js';
export interface UDSServerDeps {
    runManager: RunManager;
    budgetEnforcer: BudgetEnforcer;
    patternAnalyser: PatternAnalyser;
    auditStore: AuditStore;
    alertManager: AlertManager;
    idempotencyManager?: IdempotencyManager;
    /** Optional — provides tool config responses to the SDK. */
    configCache?: ConfigCache;
}
/**
 * Unix Domain Socket server for SDK ↔ Daemon communication.
 *
 * Accepts JSON-over-newline messages from SDK clients, routes them through
 * RunManager / BudgetEnforcer / AuditStore, and writes back DaemonResponse.
 */
export declare class UDSServer {
    private readonly socketPath;
    private readonly deps;
    private server;
    private readonly connections;
    /** stepId → step metadata buffered between step_start and step_end */
    private readonly pendingSteps;
    /** Set after construction to broadcast run/step events to WebSocket clients. */
    onEvent?: (type: string, data: Record<string, unknown>) => void;
    constructor(socketPath: string, deps: UDSServerDeps);
    /**
     * Start listening on the socket path.
     * Removes any stale socket file before binding.
     */
    start(): Promise<void>;
    /**
     * Stop the server and close all active connections.
     */
    stop(): Promise<void>;
    /** Returns the number of currently connected clients. */
    get connectionCount(): number;
    private _onConnection;
    private _handleLine;
    private _dispatchWithTimeout;
    private _dispatch;
}
//# sourceMappingURL=uds-server.d.ts.map