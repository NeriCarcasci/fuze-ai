/**
 * End-to-end integration tests: SDK client → UDSServer → AuditStore → APIServer
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { UDSServer } from '../src/uds-server.js'
import { APIServer } from '../src/api-server.js'
import { RunManager } from '../src/run-manager.js'
import { BudgetEnforcer } from '../src/budget-enforcer.js'
import { PatternAnalyser } from '../src/pattern-analyser.js'
import { AuditStore } from '../src/audit-store.js'
import { AlertManager } from '../src/alert-manager.js'

const INTG_PORT = 17822

function tempSocket() {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\fuze-intg-${id}`
    : path.join(os.tmpdir(), `fuze-intg-${id}.sock`)
}
function tempDb() { return path.join(os.tmpdir(), `fuze-intg-${Date.now()}.db`) }

/** Send multiple JSON lines over UDS and collect all responses (200ms max). */
async function sendLines(socketPath: string, lines: string[]): Promise<string[]> {
  return new Promise((resolve) => {
    const sock = net.createConnection(socketPath)
    const responses: string[] = []
    let buf = ''

    const done = () => { sock.destroy(); resolve(responses) }
    const timer = setTimeout(done, 200)

    sock.on('connect', () => {
      for (const line of lines) sock.write(line + '\n')
    })
    sock.on('data', (d: Buffer) => {
      buf += d.toString()
      const parts = buf.split('\n')
      buf = parts.pop() ?? ''
      for (const p of parts) { if (p.trim()) responses.push(p.trim()) }
    })
    sock.on('error', () => { clearTimeout(timer); done() })
    sock.on('close', () => { clearTimeout(timer); done() })
  })
}

describe('Integration: full run lifecycle', () => {
  let uds: UDSServer
  let api: APIServer
  let store: AuditStore
  let socketPath: string
  let dbPath: string
  let runManager: RunManager
  let budgetEnforcer: BudgetEnforcer

  beforeEach(async () => {
    socketPath = tempSocket()
    dbPath = tempDb()
    store = new AuditStore(dbPath)
    await store.init()
    runManager = new RunManager()
    budgetEnforcer = new BudgetEnforcer({ orgDailyTokenBudget: 100000, perAgentDailyTokenBudget: 20000, alertThreshold: 0.8 })

    const alertManager = new AlertManager({ dedupWindowMs: 0, webhookUrls: [] })

    uds = new UDSServer(socketPath, {
      runManager,
      budgetEnforcer,
      patternAnalyser: new PatternAnalyser(),
      auditStore: store,
      alertManager,
    })
    await uds.start()

    api = new APIServer(INTG_PORT, {
      runManager,
      budgetEnforcer,
      patternAnalyser: new PatternAnalyser(),
      auditStore: store,
      alertManager,
      udsServer: uds,
    })
    await api.start()
  })

  afterEach(async () => {
    await api.stop()
    await uds.stop()
    await store.close()
    if (process.platform !== 'win32' && fs.existsSync(socketPath)) fs.unlinkSync(socketPath)
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  })

  it('run_start → step_start → step_end → run_end flow', async () => {
    const responses = await sendLines(socketPath, [
      JSON.stringify({ type: 'run_start', runId: 'intg-1', agentId: 'intg-agent' }),
      JSON.stringify({ type: 'step_start', runId: 'intg-1', stepId: 'ss1', stepNumber: 1, toolName: 'tool', argsHash: 'abc', sideEffect: false }),
      JSON.stringify({ type: 'step_end', runId: 'intg-1', stepId: 'ss1', tokensIn: 100, tokensOut: 50, latencyMs: 150 }),
      JSON.stringify({ type: 'run_end', runId: 'intg-1', status: 'completed' }),
    ])

    // step_start should get a proceed response
    const proceedResp = responses.find((r) => r.includes('"proceed"'))
    expect(proceedResp).toBeTruthy()

    // Give async inserts a moment
    await new Promise((r) => setTimeout(r, 100))

    // Run should be persisted in audit store
    const run = await store.getRun('intg-1')
    expect(run?.agentId).toBe('intg-agent')
  })

  it('step_start returns kill when budget exceeded', async () => {
    // Exhaust the org budget first
    budgetEnforcer.recordSpend('intg-agent', 99900)

    const responses = await sendLines(socketPath, [
      JSON.stringify({ type: 'run_start', runId: 'intg-2', agentId: 'intg-agent' }),
      JSON.stringify({ type: 'step_start', runId: 'intg-2', stepId: 'ss2', stepNumber: 1, toolName: 'tool', argsHash: 'xyz', sideEffect: false }),
    ])
    const killResp = responses.find((r) => r.includes('"kill"'))
    expect(killResp).toBeTruthy()
  })

  it('guard_event is persisted to audit store', async () => {
    await sendLines(socketPath, [
      JSON.stringify({ type: 'run_start', runId: 'intg-3', agentId: 'intg-agent' }),
      JSON.stringify({
        type: 'guard_event', runId: 'intg-3',
        eventType: 'loop_detected', severity: 'warning', details: { count: 5 },
      }),
    ])
    await new Promise((r) => setTimeout(r, 100))
    const events = await store.getRunGuardEvents('intg-3')
    expect(events.length).toBeGreaterThanOrEqual(1)
    expect(events[0].eventType).toBe('loop_detected')
  })

  it('API /api/health reports active connections', async () => {
    const sock = net.createConnection(socketPath)
    await new Promise<void>((r) => sock.on('connect', () => r()))
    const res = await fetch(`http://127.0.0.1:${INTG_PORT}/api/health`)
    const body = await res.json() as { connections: number }
    expect(body.connections).toBeGreaterThanOrEqual(1)
    sock.destroy()
  })

  it('hash chain remains valid after multiple runs', async () => {
    for (let i = 0; i < 3; i++) {
      await sendLines(socketPath, [
        JSON.stringify({ type: 'run_start', runId: `chain-${i}`, agentId: 'chain-agent' }),
        JSON.stringify({ type: 'run_end', runId: `chain-${i}`, status: 'completed' }),
      ])
    }
    await new Promise((r) => setTimeout(r, 150))
    const result = await store.verifyHashChain()
    expect(result.valid).toBe(true)
  })

  it('run appears in API /api/runs after completion', async () => {
    await sendLines(socketPath, [
      JSON.stringify({ type: 'run_start', runId: 'api-run-1', agentId: 'api-agent' }),
      JSON.stringify({ type: 'run_end', runId: 'api-run-1', status: 'completed' }),
    ])
    await new Promise((r) => setTimeout(r, 100))
    const res = await fetch(`http://127.0.0.1:${INTG_PORT}/api/runs`)
    const body = await res.json() as { runs: { runId: string }[] }
    expect(body.runs.some((r) => r.runId === 'api-run-1')).toBe(true)
  })
})
