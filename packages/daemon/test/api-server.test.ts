import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { APIServer } from '../src/api-server.js'
import { RunManager } from '../src/run-manager.js'
import { BudgetEnforcer } from '../src/budget-enforcer.js'
import { PatternAnalyser } from '../src/pattern-analyser.js'
import { AuditStore } from '../src/audit-store.js'
import { AlertManager } from '../src/alert-manager.js'
import { UDSServer } from '../src/uds-server.js'

const TEST_PORT = 17821

function tempDb(): string {
  return path.join(os.tmpdir(), `fuze-api-db-${Date.now()}.db`)
}

function tempSocket(): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\fuze-api-sock-${id}`
    : path.join(os.tmpdir(), `fuze-api-sock-${id}.sock`)
}

async function get(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url)
  return { status: res.status, body: await res.json() }
}

async function post(url: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(url, { method: 'POST' })
  return { status: res.status, body: await res.json() }
}

describe('APIServer', () => {
  let apiServer: APIServer
  let udsServer: UDSServer
  let runManager: RunManager
  let budgetEnforcer: BudgetEnforcer
  let patternAnalyser: PatternAnalyser
  let auditStore: AuditStore
  let dbPath: string
  let socketPath: string

  beforeEach(async () => {
    dbPath = tempDb()
    socketPath = tempSocket()
    runManager = new RunManager()
    budgetEnforcer = new BudgetEnforcer({ orgDailyTokenBudget: 10000, perAgentDailyTokenBudget: 3000, alertThreshold: 0.8 })
    patternAnalyser = new PatternAnalyser()
    auditStore = new AuditStore(dbPath)
    await auditStore.init()

    const alertManager = new AlertManager({ dedupWindowMs: 0, webhookUrls: [] })
    udsServer = new UDSServer(socketPath, { runManager, budgetEnforcer, patternAnalyser, auditStore, alertManager })
    await udsServer.start()

    apiServer = new APIServer(TEST_PORT, {
      runManager, budgetEnforcer, patternAnalyser, auditStore, alertManager, udsServer,
    })
    await apiServer.start()
  })

  afterEach(async () => {
    await apiServer.stop()
    await udsServer.stop()
    await auditStore.close()
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
    if (process.platform !== 'win32' && fs.existsSync(socketPath)) fs.unlinkSync(socketPath)
  })

  it('GET /api/health returns ok', async () => {
    const { status, body } = await get(`http://127.0.0.1:${TEST_PORT}/api/health`)
    expect(status).toBe(200)
    expect((body as { status: string }).status).toBe('ok')
  })

  it('GET /api/runs returns empty list initially', async () => {
    const { body } = await get(`http://127.0.0.1:${TEST_PORT}/api/runs`)
    expect((body as { runs: unknown[] }).runs).toHaveLength(0)
  })

  it('GET /api/runs returns runs after insertion', async () => {
    await auditStore.insertRun({
      runId: 'r1', agentId: 'a1', agentVersion: '', modelProvider: '', modelName: '',
      status: 'completed', startedAt: new Date().toISOString(),
      totalTokensIn: 0, totalTokensOut: 0, totalSteps: 1, configJson: '{}',
    })
    const { body } = await get(`http://127.0.0.1:${TEST_PORT}/api/runs`)
    expect((body as { runs: unknown[] }).runs).toHaveLength(1)
  })

  it('GET /api/runs/:id returns 404 for unknown run', async () => {
    const { status } = await get(`http://127.0.0.1:${TEST_PORT}/api/runs/nonexistent`)
    expect(status).toBe(404)
  })

  it('GET /api/runs/:id returns run details', async () => {
    await auditStore.insertRun({
      runId: 'r2', agentId: 'a2', agentVersion: '', modelProvider: '', modelName: '',
      status: 'running', startedAt: new Date().toISOString(),
      totalTokensIn: 0, totalTokensOut: 0, totalSteps: 0, configJson: '{}',
    })
    const { status, body } = await get(`http://127.0.0.1:${TEST_PORT}/api/runs/r2`)
    expect(status).toBe(200)
    expect((body as { run: { agentId: string } }).run.agentId).toBe('a2')
  })

  it('POST /api/runs/:id/kill returns 404 for unknown run', async () => {
    const { status } = await post(`http://127.0.0.1:${TEST_PORT}/api/runs/nonexistent/kill`)
    expect(status).toBe(404)
  })

  it('POST /api/runs/:id/kill kills an active run', async () => {
    runManager.startRun('active-run', 'agent-a', {})
    const { status, body } = await post(`http://127.0.0.1:${TEST_PORT}/api/runs/active-run/kill`)
    expect(status).toBe(200)
    expect((body as { ok: boolean }).ok).toBe(true)
    expect(runManager.getRun('active-run')?.status).toBe('killed')
  })

  it('GET /api/budget returns org and agent token spend', async () => {
    budgetEnforcer.recordSpend('a1', 1500)
    const { status, body } = await get(`http://127.0.0.1:${TEST_PORT}/api/budget`)
    expect(status).toBe(200)
    expect((body as { org: { dailySpend: number } }).org.dailySpend).toBe(1500)
  })

  it('GET /api/agents/:id/health returns reliability stats', async () => {
    const { status, body } = await get(`http://127.0.0.1:${TEST_PORT}/api/agents/test-agent/health`)
    expect(status).toBe(200)
    expect((body as { agentId: string }).agentId).toBe('test-agent')
  })

  it('GET unknown path returns 404', async () => {
    const { status } = await get(`http://127.0.0.1:${TEST_PORT}/api/unknown-path`)
    expect(status).toBe(404)
  })

  it('GET /api/compliance/report/:id returns report for existing run', async () => {
    await auditStore.insertRun({
      runId: 'r-report', agentId: 'a1', agentVersion: '1.0', modelProvider: 'openai', modelName: 'gpt-4',
      status: 'completed', startedAt: new Date().toISOString(),
      totalTokensIn: 100, totalTokensOut: 200, totalSteps: 1, configJson: '{}',
    })
    const { status, body } = await get(`http://127.0.0.1:${TEST_PORT}/api/compliance/report/r-report`)
    expect(status).toBe(200)
    const report = body as { reportVersion: string; run: { runId: string } }
    expect(report.reportVersion).toBe('1.0')
    expect(report.run.runId).toBe('r-report')
  })

  it('GET /api/runs with non-numeric limit returns valid response', async () => {
    const { status, body } = await get(`http://127.0.0.1:${TEST_PORT}/api/runs?limit=abc`)
    expect(status).toBe(200)
    expect((body as { runs: unknown[] }).runs).toBeInstanceOf(Array)
  })

  it('GET /api/compliance/report/:id returns 404 for unknown run', async () => {
    const { status } = await get(`http://127.0.0.1:${TEST_PORT}/api/compliance/report/nonexistent`)
    expect(status).toBe(404)
  })
})
