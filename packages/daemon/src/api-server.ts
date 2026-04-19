import * as http from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import type { RunManager } from './run-manager.js'
import type { BudgetEnforcer } from './budget-enforcer.js'
import type { PatternAnalyser } from './pattern-analyser.js'
import type { AuditStore } from './audit-store.js'
import type { AlertManager } from './alert-manager.js'
import type { UDSServer } from './uds-server.js'
import type { CompensationEngine } from './compensation/compensation-engine.js'

export interface APIServerDeps {
  runManager: RunManager
  budgetEnforcer: BudgetEnforcer
  patternAnalyser: PatternAnalyser
  auditStore: AuditStore
  alertManager: AlertManager
  udsServer: UDSServer
  compensationEngine?: CompensationEngine
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
export class APIServer {
  private httpServer!: http.Server
  private wss!: WebSocketServer

  constructor(
    private readonly port: number,
    private readonly deps: APIServerDeps,
  ) {}

  async start(): Promise<void> {
    this.httpServer = http.createServer((req, res) => this._route(req, res))
    this.wss = new WebSocketServer({ server: this.httpServer })
    this.wss.on('connection', (ws) => this._onWsConnection(ws))

    return new Promise((resolve, reject) => {
      this.httpServer.on('error', reject)
      this.httpServer.listen(this.port, '127.0.0.1', () => resolve())
    })
  }

  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss.close()
      this.httpServer.close((err) => {
        if (err) reject(err)
        else resolve()
      })
    })
  }

  /**
   * Broadcast an alert payload to all connected WebSocket clients.
   */
  broadcast(data: unknown): void {
    const payload = JSON.stringify(data)
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload)
      }
    }
  }

  // ── Routing ───────────────────────────────────────────────────────────────

  private _route(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = req.url ?? '/'
    const method = req.method ?? 'GET'

    // CORS for local dev
    res.setHeader('Access-Control-Allow-Origin', '*')

    if (method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // Route dispatch — API routes
    if (url.startsWith('/api/') || url === '/api') {
      res.setHeader('Content-Type', 'application/json')
      this._routeApi(url, method, req, res)
      return
    }

    // WebSocket upgrade is handled by ws library — skip non-ws /ws requests
    if (url === '/ws') {
      this._json(res, 400, { error: 'Use WebSocket' })
      return
    }

    this._json(res, 404, { error: 'Not found' })
  }

  private readonly routes: Array<{
    method: string
    pattern: RegExp
    handler: (match: RegExpMatchArray, req: http.IncomingMessage, res: http.ServerResponse) => void
  }> = [
    { method: 'GET', pattern: /^\/api\/health$/, handler: (_m, _req, res) => this._handleHealth(res) },
    { method: 'GET', pattern: /^\/api\/runs\/([^/]+)\/compensation$/, handler: (m, _req, res) => void this._handleGetCompensation(m[1], res) },
    { method: 'POST', pattern: /^\/api\/runs\/([^/]+)\/rollback$/, handler: (m, req, res) => void this._handleRollback(m[1], req, res) },
    { method: 'POST', pattern: /^\/api\/runs\/([^/]+)\/kill$/, handler: (m, _req, res) => this._handleKillRun(m[1], res) },
    { method: 'GET', pattern: /^\/api\/runs\/([^/?]+)$/, handler: (m, _req, res) => void this._handleGetRun(m[1], res) },
    { method: 'GET', pattern: /^\/api\/runs(\?.*)?$/, handler: (_m, req, res) => void this._handleListRuns(req, res) },
    { method: 'GET', pattern: /^\/api\/budget$/, handler: (_m, _req, res) => this._handleBudget(res) },
    { method: 'GET', pattern: /^\/api\/agents\/([^/?]+)\/health$/, handler: (m, _req, res) => this._handleAgentHealth(m[1], res) },
    { method: 'GET', pattern: /^\/api\/compliance\/report\/([^/?]+)$/, handler: (m, _req, res) => void this._handleComplianceReport(m[1], res) },
  ]

  private _routeApi(
    url: string,
    method: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): void {
    try {
      for (const route of this.routes) {
        if (method !== route.method) continue
        const match = url.match(route.pattern)
        if (match) {
          route.handler(match, req, res)
          return
        }
      }
      this._json(res, 404, { error: 'Not found' })
    } catch (err) {
      this._json(res, 500, { error: (err as Error).message })
    }
  }

  // ── API Handlers ──────────────────────────────────────────────────────────

  private _handleHealth(res: http.ServerResponse): void {
    this._json(res, 200, {
      status: 'ok',
      activeRuns: this.deps.runManager.getActiveRunCount(),
      connections: this.deps.udsServer.connectionCount,
      timestamp: new Date().toISOString(),
    })
  }

  private async _handleListRuns(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const query = new URL(req.url ?? '', 'http://localhost').searchParams
    const rawLimit = query.get('limit')
    const rawOffset = query.get('offset')
    const opts = {
      agentId: query.get('agentId') ?? undefined,
      status: query.get('status') ?? undefined,
      since: query.get('since') ?? undefined,
      limit: rawLimit != null ? Math.max(1, Math.min(1000, parseInt(rawLimit, 10) || 50)) : 50,
      offset: rawOffset != null ? Math.max(0, parseInt(rawOffset, 10) || 0) : 0,
    }
    const [runs, total] = await Promise.all([
      this.deps.auditStore.listRuns(opts),
      this.deps.auditStore.countRuns(opts),
    ])
    this._json(res, 200, { runs, total, ...opts })
  }

  private async _handleGetRun(runId: string, res: http.ServerResponse): Promise<void> {
    const run = await this.deps.auditStore.getRun(runId)
    if (!run) {
      this._json(res, 404, { error: `Run '${runId}' not found` })
      return
    }
    const [steps, guardEvents] = await Promise.all([
      this.deps.auditStore.getRunSteps(runId),
      this.deps.auditStore.getRunGuardEvents(runId),
    ])
    this._json(res, 200, { run, steps, guardEvents })
  }

  private _handleKillRun(runId: string, res: http.ServerResponse): void {
    const run = this.deps.runManager.getRun(runId)
    if (!run || run.status !== 'running') {
      this._json(res, 404, { error: `Active run '${runId}' not found` })
      return
    }
    this.deps.runManager.killRun(runId, 'Killed via API')
    void this.deps.auditStore.updateRunStatus(runId, 'killed')
    this._json(res, 200, { ok: true, runId })
  }

  private async _handleGetCompensation(runId: string, res: http.ServerResponse): Promise<void> {
    const run = await this.deps.auditStore.getRun(runId)
    if (!run) {
      this._json(res, 404, { error: `Run '${runId}' not found` })
      return
    }
    const records = await this.deps.auditStore.getCompensationByRun(runId)
    this._json(res, 200, { runId, records })
  }

  private async _handleRollback(
    runId: string,
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> {
    if (!this.deps.compensationEngine) {
      this._json(res, 503, { error: 'Compensation engine not available' })
      return
    }
    const run = await this.deps.auditStore.getRun(runId)
    if (!run) {
      this._json(res, 404, { error: `Run '${runId}' not found` })
      return
    }

    // Parse optional fromStepId from body
    let fromStepId = ''
    try {
      const body = await this._readBody(req)
      if (body) {
        const parsed = JSON.parse(body) as { fromStepId?: string }
        fromStepId = parsed.fromStepId ?? ''
      }
    } catch {
      // ignore parse errors — use last step
    }

    // If no fromStepId, use the last step of the run
    if (!fromStepId) {
      const steps = await this.deps.auditStore.getRunSteps(runId)
      fromStepId = steps[steps.length - 1]?.stepId ?? ''
    }

    try {
      const result = await this.deps.compensationEngine.rollback(runId, fromStepId)
      this._json(res, 200, result)
    } catch (err) {
      this._json(res, 500, { error: (err as Error).message })
    }
  }

  private async _handleComplianceReport(runId: string, res: http.ServerResponse): Promise<void> {
    const run = await this.deps.auditStore.getRun(runId)
    if (!run) {
      this._json(res, 404, { error: `Run '${runId}' not found` })
      return
    }
    const [steps, guardEvents, compensation, retention] = await Promise.all([
      this.deps.auditStore.getRunSteps(runId),
      this.deps.auditStore.getRunGuardEvents(runId),
      this.deps.auditStore.getCompensationByRun(runId),
      this.deps.auditStore.getRetentionStatus(),
    ])

    const sideEffectSteps = steps.filter((s) => s.hasSideEffect === 1)
    const criticalEvents = guardEvents.filter((e) => e.severity === 'critical')

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
        totalTokensIn: run.totalTokensIn,
        totalTokensOut: run.totalTokensOut,
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
        tokensIn: s.tokensIn,
        tokensOut: s.tokensOut,
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
        details: JSON.parse(e.detailsJson) as unknown,
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
    }

    this._json(res, 200, report)
  }

  private _handleBudget(res: http.ServerResponse): void {
    const org = this.deps.budgetEnforcer.getOrgSpend()
    const allAgents = this.deps.budgetEnforcer.getAllAgentSpend()

    // Transform to match dashboard client.ts BudgetResponse interface
    const agents: Record<string, { spent: number; budget: number }> = {}
    for (const [agentId, spend] of Object.entries(allAgents)) {
      agents[agentId] = { spent: spend.today, budget: spend.ceiling }
    }

    this._json(res, 200, {
      org: {
        dailySpend: org.today,
        dailyBudget: org.ceiling,
        runningAgents: this.deps.runManager.getActiveRuns().length,
      },
      agents,
    })
  }

  private _handleAgentHealth(agentId: string, res: http.ServerResponse): void {
    const reliability = this.deps.patternAnalyser.getAgentReliability(agentId)
    const spend = this.deps.budgetEnforcer.getAgentSpend(agentId)
    this._json(res, 200, { agentId, reliability, spend })
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  private _onWsConnection(ws: WebSocket): void {
    ws.send(JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() }))
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _json(res: http.ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body)
    res.writeHead(status)
    res.end(payload)
  }

  private _readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let data = ''
      req.on('data', (chunk: Buffer) => { data += chunk.toString() })
      req.on('end', () => resolve(data))
      req.on('error', reject)
    })
  }
}
