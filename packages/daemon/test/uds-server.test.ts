import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import * as fs from 'node:fs'
import { UDSServer } from '../src/uds-server.js'
import { RunManager } from '../src/run-manager.js'
import { BudgetEnforcer } from '../src/budget-enforcer.js'
import { PatternAnalyser } from '../src/pattern-analyser.js'
import { AuditStore } from '../src/audit-store.js'
import { AlertManager } from '../src/alert-manager.js'

function tempSocket(): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  return process.platform === 'win32'
    ? `\\\\.\\pipe\\fuze-uds-test-${id}`
    : path.join(os.tmpdir(), `fuze-uds-test-${id}.sock`)
}

function tempDb(): string {
  return path.join(os.tmpdir(), `fuze-uds-db-${Date.now()}.db`)
}

async function sendLine(socketPath: string, line: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const sock = net.createConnection(socketPath)
    let response = ''
    const timer = setTimeout(() => resolve(response), 200)

    sock.on('connect', () => {
      sock.write(line + '\n')
    })
    sock.on('data', (d) => {
      response += d.toString()
      clearTimeout(timer)
      sock.destroy()
      resolve(response)
    })
    sock.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    sock.on('close', () => {
      clearTimeout(timer)
      resolve(response)
    })
  })
}

describe('UDSServer', () => {
  let server: UDSServer
  let socketPath: string
  let dbPath: string
  let auditStore: AuditStore
  let patternAnalyser: PatternAnalyser

  beforeEach(async () => {
    socketPath = tempSocket()
    dbPath = tempDb()
    auditStore = new AuditStore(dbPath)
    await auditStore.init()
    patternAnalyser = new PatternAnalyser()

    server = new UDSServer(socketPath, {
      runManager: new RunManager(),
      budgetEnforcer: new BudgetEnforcer({ orgDailyBudget: 100, perAgentDailyBudget: 20, alertThreshold: 0.8 }),
      patternAnalyser,
      auditStore,
      alertManager: new AlertManager({ dedupWindowMs: 0, webhookUrls: [] }),
    })
    await server.start()
  })

  afterEach(async () => {
    await server.stop()
    await auditStore.close()
    if (process.platform !== 'win32' && fs.existsSync(socketPath)) fs.unlinkSync(socketPath)
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath)
  })

  it('starts and accepts connections', async () => {
    const sock = net.createConnection(socketPath)
    await new Promise<void>((resolve) => sock.on('connect', () => { sock.destroy(); resolve() }))
    expect(true).toBe(true)
  })

  it('removes stale socket on restart (Unix only)', async () => {
    if (process.platform === 'win32') return // named pipes don't leave stale files

    const stalePath = tempSocket()
    fs.writeFileSync(stalePath, 'stale')
    const s2 = new UDSServer(stalePath, {
      runManager: new RunManager(),
      budgetEnforcer: new BudgetEnforcer({ orgDailyBudget: 100, perAgentDailyBudget: 20, alertThreshold: 0.8 }),
      patternAnalyser: new PatternAnalyser(),
      auditStore,
      alertManager: new AlertManager({ dedupWindowMs: 0, webhookUrls: [] }),
    })
    await s2.start()
    await s2.stop()
    if (fs.existsSync(stalePath)) fs.unlinkSync(stalePath)
  })

  it('responds with proceed to step_start within budget', async () => {
    // First send run_start
    await sendLine(socketPath, JSON.stringify({
      type: 'run_start', runId: 'r1', agentId: 'a1',
    }))

    const response = await sendLine(socketPath, JSON.stringify({
      type: 'step_start', runId: 'r1', stepId: 's1', stepNumber: 1,
      toolName: 'tool', argsHash: 'abc', sideEffect: false,
    }))
    const parsed = JSON.parse(response.trim())
    expect(parsed.type).toBe('proceed')
  })

  it('handles malformed JSON without crashing', async () => {
    const sock = net.createConnection(socketPath)
    await new Promise<void>((resolve) => sock.on('connect', () => resolve()))
    sock.write('this is not json\n')
    await new Promise((r) => setTimeout(r, 50))
    expect(server.connectionCount).toBeGreaterThanOrEqual(0)
    sock.destroy()
  })

  it('tracks connection count', async () => {
    const socks: net.Socket[] = []
    for (let i = 0; i < 3; i++) {
      const s = net.createConnection(socketPath)
      await new Promise<void>((r) => s.on('connect', () => r()))
      socks.push(s)
    }
    // Allow a tick for the server-side connection event to fire
    await new Promise((r) => setTimeout(r, 20))
    expect(server.connectionCount).toBe(3)
    for (const s of socks) s.destroy()
    await new Promise((r) => setTimeout(r, 50))
    expect(server.connectionCount).toBe(0)
  })

  it('persists run_start to audit store', async () => {
    await sendLine(socketPath, JSON.stringify({
      type: 'run_start', runId: 'r-persist', agentId: 'agent-p',
    }))
    await new Promise((r) => setTimeout(r, 50))
    const run = await auditStore.getRun('r-persist')
    expect(run?.agentId).toBe('agent-p')
  })

  it('rejects oversized UDS payload buffers', async () => {
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const sock = net.createConnection(socketPath)
    await new Promise<void>((resolve) => sock.on('connect', () => resolve()))

    const closed = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('socket was not closed for oversized payload')), 1000)
      sock.on('close', () => {
        clearTimeout(timeout)
        resolve()
      })
      sock.on('error', () => {
        clearTimeout(timeout)
        resolve()
      })
    })

    sock.write('x'.repeat(1_048_577))
    await closed

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('oversized UDS message buffer'))
    warnSpy.mockRestore()
  })

  it('passes correct failedAtStep and failedTool to pattern analyser on run_end', async () => {
    const outcomeSpy = vi.spyOn(patternAnalyser, 'recordRunOutcome')

    await sendLine(socketPath, JSON.stringify({
      type: 'run_start', runId: 'r-pattern', agentId: 'agent-pattern',
    }))
    await sendLine(socketPath, JSON.stringify({
      type: 'step_start', runId: 'r-pattern', stepId: 'step-42', stepNumber: 1,
      toolName: 'dangerous_tool', argsHash: 'abc42', sideEffect: false,
    }))
    await sendLine(socketPath, JSON.stringify({
      type: 'step_end', runId: 'r-pattern', stepId: 'step-42',
      costUsd: 1.23, tokensIn: 10, tokensOut: 20, latencyMs: 33,
    }))
    await sendLine(socketPath, JSON.stringify({
      type: 'run_end', runId: 'r-pattern', status: 'failed', totalCost: 1.23,
    }))

    expect(outcomeSpy).toHaveBeenCalledWith(
      'agent-pattern',
      'failed',
      'step-42',
      'dangerous_tool',
      1.23,
    )
  })

  it('returns an error response when dispatch exceeds 30s', async () => {
    vi.useFakeTimers()
    const warnSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    vi.spyOn(server as unknown as { _dispatch: (msg: unknown) => Promise<unknown> }, '_dispatch')
      .mockImplementation(async () => new Promise(() => {}))

    const timeoutPromise = (server as unknown as {
      _dispatchWithTimeout: (msg: unknown) => Promise<{ type: string; message: string } | null>
    })._dispatchWithTimeout({ type: 'get_config' })

    await vi.advanceTimersByTimeAsync(30_000)
    const response = await timeoutPromise

    expect(response).toEqual({ type: 'error', message: 'dispatch_timeout' })
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('dispatch timed out after 30000ms'))

    warnSpy.mockRestore()
    vi.useRealTimers()
  })
})
