import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Dashboard dist is at packages/dashboard/dist relative to this file's package root
const DASHBOARD_DIST = path.resolve(__dirname, '..', '..', 'dashboard', 'dist');
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
 * Static files:
 *   GET  /                                — dashboard SPA (fallback to index.html)
 */
export class APIServer {
    port;
    deps;
    httpServer;
    wss;
    constructor(port, deps) {
        this.port = port;
        this.deps = deps;
    }
    async start() {
        this.httpServer = http.createServer((req, res) => this._route(req, res));
        this.wss = new WebSocketServer({ server: this.httpServer });
        this.wss.on('connection', (ws) => this._onWsConnection(ws));
        return new Promise((resolve, reject) => {
            this.httpServer.on('error', reject);
            this.httpServer.listen(this.port, '127.0.0.1', () => resolve());
        });
    }
    async stop() {
        return new Promise((resolve, reject) => {
            this.wss.close();
            this.httpServer.close((err) => {
                if (err)
                    reject(err);
                else
                    resolve();
            });
        });
    }
    /**
     * Broadcast an alert payload to all connected WebSocket clients.
     */
    broadcast(data) {
        const payload = JSON.stringify(data);
        for (const client of this.wss.clients) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(payload);
            }
        }
    }
    // ── Routing ───────────────────────────────────────────────────────────────
    _route(req, res) {
        const url = req.url ?? '/';
        const method = req.method ?? 'GET';
        // CORS for local dev
        res.setHeader('Access-Control-Allow-Origin', '*');
        if (method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        // Route dispatch — API routes
        if (url.startsWith('/api/') || url === '/api') {
            res.setHeader('Content-Type', 'application/json');
            this._routeApi(url, method, req, res);
            return;
        }
        // WebSocket upgrade is handled by ws library — skip non-ws /ws requests
        if (url === '/ws') {
            this._json(res, 400, { error: 'Use WebSocket' });
            return;
        }
        // Static file serving for dashboard SPA
        this._serveStatic(url, res);
    }
    routes = [
        { method: 'GET', pattern: /^\/api\/health$/, handler: (_m, _req, res) => this._handleHealth(res) },
        { method: 'GET', pattern: /^\/api\/runs\/([^/]+)\/compensation$/, handler: (m, _req, res) => void this._handleGetCompensation(m[1], res) },
        { method: 'POST', pattern: /^\/api\/runs\/([^/]+)\/rollback$/, handler: (m, req, res) => void this._handleRollback(m[1], req, res) },
        { method: 'POST', pattern: /^\/api\/runs\/([^/]+)\/kill$/, handler: (m, _req, res) => this._handleKillRun(m[1], res) },
        { method: 'GET', pattern: /^\/api\/runs\/([^/?]+)$/, handler: (m, _req, res) => void this._handleGetRun(m[1], res) },
        { method: 'GET', pattern: /^\/api\/runs(\?.*)?$/, handler: (_m, req, res) => void this._handleListRuns(req, res) },
        { method: 'GET', pattern: /^\/api\/budget$/, handler: (_m, _req, res) => this._handleBudget(res) },
        { method: 'GET', pattern: /^\/api\/agents\/([^/?]+)\/health$/, handler: (m, _req, res) => this._handleAgentHealth(m[1], res) },
        { method: 'GET', pattern: /^\/api\/compliance\/report\/([^/?]+)$/, handler: (m, _req, res) => void this._handleComplianceReport(m[1], res) },
    ];
    _routeApi(url, method, req, res) {
        try {
            for (const route of this.routes) {
                if (method !== route.method)
                    continue;
                const match = url.match(route.pattern);
                if (match) {
                    route.handler(match, req, res);
                    return;
                }
            }
            this._json(res, 404, { error: 'Not found' });
        }
        catch (err) {
            this._json(res, 500, { error: err.message });
        }
    }
    // ── API Handlers ──────────────────────────────────────────────────────────
    _handleHealth(res) {
        this._json(res, 200, {
            status: 'ok',
            activeRuns: this.deps.runManager.getActiveRunCount(),
            connections: this.deps.udsServer.connectionCount,
            timestamp: new Date().toISOString(),
        });
    }
    async _handleListRuns(req, res) {
        const query = new URL(req.url ?? '', 'http://localhost').searchParams;
        const rawLimit = query.get('limit');
        const rawOffset = query.get('offset');
        const opts = {
            agentId: query.get('agentId') ?? undefined,
            status: query.get('status') ?? undefined,
            since: query.get('since') ?? undefined,
            limit: rawLimit != null ? Math.max(1, Math.min(1000, parseInt(rawLimit, 10) || 50)) : 50,
            offset: rawOffset != null ? Math.max(0, parseInt(rawOffset, 10) || 0) : 0,
        };
        const [runs, total] = await Promise.all([
            this.deps.auditStore.listRuns(opts),
            this.deps.auditStore.countRuns(opts),
        ]);
        this._json(res, 200, { runs, total, ...opts });
    }
    async _handleGetRun(runId, res) {
        const run = await this.deps.auditStore.getRun(runId);
        if (!run) {
            this._json(res, 404, { error: `Run '${runId}' not found` });
            return;
        }
        const [steps, guardEvents] = await Promise.all([
            this.deps.auditStore.getRunSteps(runId),
            this.deps.auditStore.getRunGuardEvents(runId),
        ]);
        this._json(res, 200, { run, steps, guardEvents });
    }
    _handleKillRun(runId, res) {
        const run = this.deps.runManager.getRun(runId);
        if (!run || run.status !== 'running') {
            this._json(res, 404, { error: `Active run '${runId}' not found` });
            return;
        }
        this.deps.runManager.killRun(runId, 'Killed via API');
        void this.deps.auditStore.updateRunStatus(runId, 'killed', run.totalCost);
        this._json(res, 200, { ok: true, runId });
    }
    async _handleGetCompensation(runId, res) {
        const run = await this.deps.auditStore.getRun(runId);
        if (!run) {
            this._json(res, 404, { error: `Run '${runId}' not found` });
            return;
        }
        const records = await this.deps.auditStore.getCompensationByRun(runId);
        this._json(res, 200, { runId, records });
    }
    async _handleRollback(runId, req, res) {
        if (!this.deps.compensationEngine) {
            this._json(res, 503, { error: 'Compensation engine not available' });
            return;
        }
        const run = await this.deps.auditStore.getRun(runId);
        if (!run) {
            this._json(res, 404, { error: `Run '${runId}' not found` });
            return;
        }
        // Parse optional fromStepId from body
        let fromStepId = '';
        try {
            const body = await this._readBody(req);
            if (body) {
                const parsed = JSON.parse(body);
                fromStepId = parsed.fromStepId ?? '';
            }
        }
        catch {
            // ignore parse errors — use last step
        }
        // If no fromStepId, use the last step of the run
        if (!fromStepId) {
            const steps = await this.deps.auditStore.getRunSteps(runId);
            fromStepId = steps[steps.length - 1]?.stepId ?? '';
        }
        try {
            const result = await this.deps.compensationEngine.rollback(runId, fromStepId);
            this._json(res, 200, result);
        }
        catch (err) {
            this._json(res, 500, { error: err.message });
        }
    }
    async _handleComplianceReport(runId, res) {
        const run = await this.deps.auditStore.getRun(runId);
        if (!run) {
            this._json(res, 404, { error: `Run '${runId}' not found` });
            return;
        }
        const [steps, guardEvents, compensation, retention] = await Promise.all([
            this.deps.auditStore.getRunSteps(runId),
            this.deps.auditStore.getRunGuardEvents(runId),
            this.deps.auditStore.getCompensationByRun(runId),
            this.deps.auditStore.getRetentionStatus(),
        ]);
        const sideEffectSteps = steps.filter((s) => s.hasSideEffect === 1);
        const criticalEvents = guardEvents.filter((e) => e.severity === 'critical');
        const report = {
            reportVersion: '1.0',
            generatedAt: new Date().toISOString(),
            systemId: 'fuze-ai-daemon',
            run: {
                runId: run.runId,
                agentId: run.agentId,
                agentVersion: run.agentVersion,
                model: `${run.modelProvider}/${run.modelName}`,
                status: run.status,
                startedAt: run.startedAt,
                endedAt: run.endedAt,
                totalCost: run.totalCost,
                totalSteps: run.totalSteps,
            },
            traceSummary: {
                totalSteps: steps.length,
                sideEffectSteps: sideEffectSteps.length,
                guardEvents: guardEvents.length,
                criticalEvents: criticalEvents.length,
            },
            actions: steps.map((s) => ({
                stepId: s.stepId,
                toolName: s.toolName,
                startedAt: s.startedAt,
                endedAt: s.endedAt,
                costUsd: s.costUsd,
                hasSideEffect: s.hasSideEffect === 1,
                error: s.error,
            })),
            sideEffects: sideEffectSteps.map((s) => ({
                stepId: s.stepId,
                toolName: s.toolName,
                argsHash: s.argsHash,
            })),
            compensation: compensation.map((c) => ({
                compensationId: c.compensationId,
                stepId: c.stepId,
                toolName: c.toolName,
                status: c.compensationStatus,
                error: c.compensationError,
                escalated: c.escalated,
            })),
            guardEvents: guardEvents.map((e) => ({
                eventId: e.eventId,
                eventType: e.eventType,
                severity: e.severity,
                timestamp: e.timestamp,
                details: JSON.parse(e.detailsJson),
            })),
            humanOversight: {
                killSwitchAvailable: true,
                killSwitchUsed: run.status === 'killed',
                loopDetectionEnabled: true,
                budgetEnforcementEnabled: true,
            },
            auditIntegrity: {
                totalRecords: retention.totalRuns,
                oldestRecord: retention.oldestRun,
            },
        };
        this._json(res, 200, report);
    }
    _handleBudget(res) {
        const org = this.deps.budgetEnforcer.getOrgSpend();
        const allAgents = this.deps.budgetEnforcer.getAllAgentSpend();
        // Transform to match dashboard client.ts BudgetResponse interface
        const agents = {};
        for (const [agentId, spend] of Object.entries(allAgents)) {
            agents[agentId] = { spent: spend.today, budget: spend.ceiling };
        }
        this._json(res, 200, {
            org: {
                dailySpend: org.today,
                dailyBudget: org.ceiling,
                runningAgents: this.deps.runManager.getActiveRuns().length,
            },
            agents,
        });
    }
    _handleAgentHealth(agentId, res) {
        const reliability = this.deps.patternAnalyser.getAgentReliability(agentId);
        const spend = this.deps.budgetEnforcer.getAgentSpend(agentId);
        this._json(res, 200, { agentId, reliability, spend });
    }
    // ── Static file serving ───────────────────────────────────────────────────
    _serveStatic(urlPath, res) {
        if (!fs.existsSync(DASHBOARD_DIST)) {
            // Dashboard not built yet — show placeholder
            res.setHeader('Content-Type', 'text/html');
            res.writeHead(200);
            res.end('<html><body><h1>Fuze AI Dashboard</h1><p>Run <code>npm run build --workspace=packages/dashboard</code> to build the dashboard.</p></body></html>');
            return;
        }
        // Sanitize path to prevent directory traversal
        const relPath = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
        const filePath = path.resolve(DASHBOARD_DIST, relPath);
        // Ensure we stay within DASHBOARD_DIST (path.relative handles Windows paths)
        const rel = path.relative(DASHBOARD_DIST, filePath);
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
            res.writeHead(403);
            res.end();
            return;
        }
        if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
            // SPA fallback — serve index.html for client-side routing
            const indexPath = path.join(DASHBOARD_DIST, 'index.html');
            if (!fs.existsSync(indexPath)) {
                res.writeHead(404);
                res.end();
                return;
            }
            res.setHeader('Content-Type', 'text/html');
            res.writeHead(200);
            fs.createReadStream(indexPath).pipe(res);
            return;
        }
        const ext = path.extname(filePath);
        const mimeTypes = {
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.svg': 'image/svg+xml',
            '.ico': 'image/x-icon',
            '.woff2': 'font/woff2',
            '.woff': 'font/woff',
        };
        res.setHeader('Content-Type', mimeTypes[ext] ?? 'application/octet-stream');
        res.writeHead(200);
        fs.createReadStream(filePath).pipe(res);
    }
    // ── WebSocket ─────────────────────────────────────────────────────────────
    _onWsConnection(ws) {
        ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }));
    }
    // ── Helpers ───────────────────────────────────────────────────────────────
    _json(res, status, body) {
        const payload = JSON.stringify(body);
        res.writeHead(status);
        res.end(payload);
    }
    _readBody(req) {
        return new Promise((resolve, reject) => {
            let data = '';
            req.on('data', (chunk) => { data += chunk.toString(); });
            req.on('end', () => resolve(data));
            req.on('error', reject);
        });
    }
}
//# sourceMappingURL=api-server.js.map