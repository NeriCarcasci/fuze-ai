import type { RunManager } from './run-manager.js';
import type { BudgetEnforcer } from './budget-enforcer.js';
import type { PatternAnalyser } from './pattern-analyser.js';
import type { AuditStore } from './audit-store.js';
import type { AlertManager } from './alert-manager.js';
import type { UDSServer } from './uds-server.js';
import type { CompensationEngine } from './compensation/compensation-engine.js';
export interface APIServerDeps {
    runManager: RunManager;
    budgetEnforcer: BudgetEnforcer;
    patternAnalyser: PatternAnalyser;
    auditStore: AuditStore;
    alertManager: AlertManager;
    udsServer: UDSServer;
    compensationEngine?: CompensationEngine;
}
/**
 * HTTP + WebSocket API server.
 *
 * Endpoints:
 *   GET  /api/health                      — daemon liveness
 *   GET  /api/runs                        — paginated run list
 *   GET  /api/runs/:id                    — single run + steps + events
 *   POST /api/runs/:id/kill               — kill an active run
 *   GET  /api/runs/:id/compensation       — compensation records for a run
 *   POST /api/runs/:id/rollback           — trigger manual rollback
 *   GET  /api/budget                      — org + per-agent spend
 *   GET  /api/agents/:id/health           — agent reliability stats
 *   GET  /api/compliance/report/:id       — incident report JSON
 *
 * WebSocket:
 *   ws://host/ws                          — live alerts stream
 *
 */
export declare class APIServer {
    private readonly port;
    private readonly deps;
    private httpServer;
    private wss;
    constructor(port: number, deps: APIServerDeps);
    start(): Promise<void>;
    stop(): Promise<void>;
    /**
     * Broadcast an alert payload to all connected WebSocket clients.
     */
    broadcast(data: unknown): void;
    private _route;
    private readonly routes;
    private _routeApi;
    private _handleHealth;
    private _handleListRuns;
    private _handleGetRun;
    private _handleKillRun;
    private _handleGetCompensation;
    private _handleRollback;
    private _handleComplianceReport;
    private _handleBudget;
    private _handleAgentHealth;
    private _onWsConnection;
    private _json;
    private _readBody;
}
//# sourceMappingURL=api-server.d.ts.map