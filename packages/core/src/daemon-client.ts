import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import type { DaemonResponse } from './types.js'

const DEFAULT_SOCKET = process.platform === 'win32'
  ? '\\\\.\\pipe\\fuze-daemon'
  : path.join(os.tmpdir(), 'fuze-daemon.sock')
const STEP_TIMEOUT_MS = 10
const RECONNECT_BASE_MS = 100
const RECONNECT_MAX_MS = 5_000

interface PendingRequest {
  resolve: (value: DaemonResponse) => void
  timer: ReturnType<typeof setTimeout>
}

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
export class DaemonClient {
  private socket: net.Socket | null = null
  private buf = ''
  private pending: PendingRequest | null = null
  private reconnectMs = RECONNECT_BASE_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false

  constructor(private readonly socketPath: string = DEFAULT_SOCKET) {
    this._connect()
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Notify the daemon that a run has started.
   * Fire-and-forget.
   */
  notifyRunStart(
    runId: string,
    agentId: string,
    opts: { agentVersion?: string; modelProvider?: string; modelName?: string; config?: Record<string, unknown> } = {},
  ): void {
    this._send({
      type: 'run_start',
      runId,
      agentId,
      ...opts,
    })
  }

  /**
   * Notify the daemon that a run has ended.
   * Fire-and-forget.
   */
  notifyRunEnd(runId: string, status: string, totalCost: number): void {
    this._send({
      type: 'run_end',
      runId,
      status,
      totalCost,
    })
  }

  /**
   * Send step_start to the daemon and wait up to 10 ms for a response.
   *
   * Falls back to { action: 'proceed' } on timeout or disconnection.
   *
   * @returns 'proceed' or 'kill' decision.
   */
  async checkStep(
    runId: string,
    stepId: string,
    stepNumber: number,
    toolName: string,
    argsHash: string,
    sideEffect = false,
  ): Promise<DaemonResponse> {
    if (!this.socket || this.socket.destroyed) {
      return { action: 'proceed' }
    }

    return new Promise<DaemonResponse>((resolve) => {
      const timer = setTimeout(() => {
        this.pending = null
        resolve({ action: 'proceed' })
      }, STEP_TIMEOUT_MS)

      this.pending = { resolve, timer }

      const sent = this._send({
        type: 'step_start',
        runId,
        stepId,
        stepNumber,
        toolName,
        argsHash,
        sideEffect,
      })

      if (!sent) {
        clearTimeout(timer)
        this.pending = null
        resolve({ action: 'proceed' })
      }
    })
  }

  /**
   * Notify the daemon that a step has ended.
   * Fire-and-forget.
   */
  notifyStepEnd(
    runId: string,
    stepId: string,
    costUsd: number,
    tokensIn: number,
    tokensOut: number,
    latencyMs: number,
    error?: string | null,
  ): void {
    this._send({
      type: 'step_end',
      runId,
      stepId,
      costUsd,
      tokensIn,
      tokensOut,
      latencyMs,
      error,
    })
  }

  /**
   * Notify the daemon of a guard event.
   * Fire-and-forget.
   */
  notifyGuardEvent(
    runId: string,
    eventType: string,
    severity: string,
    details: Record<string, unknown> = {},
    stepId?: string,
  ): void {
    this._send({
      type: 'guard_event',
      runId,
      stepId,
      eventType,
      severity,
      details,
    })
  }

  /**
   * Legacy check() kept for backward compatibility.
   * Calls checkStep with defaults.
   */
  async check(runId: string, stepId: string): Promise<DaemonResponse> {
    return this.checkStep(runId, stepId, 0, 'unknown', '0'.repeat(16))
  }

  /**
   * Permanently close the connection.
   */
  disconnect(): void {
    this.closed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _connect(): void {
    if (this.closed) return

    const sock = net.createConnection(this.socketPath)
    this.socket = sock
    this.buf = ''

    sock.on('connect', () => {
      this.reconnectMs = RECONNECT_BASE_MS
    })

    sock.on('data', (chunk: Buffer) => {
      this.buf += chunk.toString('utf8')
      const lines = this.buf.split('\n')
      this.buf = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed) this._onMessage(trimmed)
      }
    })

    sock.on('error', () => {
      // Error is handled by 'close'
    })

    sock.on('close', () => {
      this.socket = null
      this._resolvePendingWithProceed()
      this._scheduleReconnect()
    })
  }

  private _send(msg: Record<string, unknown>): boolean {
    if (!this.socket || this.socket.destroyed) return false
    try {
      this.socket.write(JSON.stringify(msg) + '\n')
      return true
    } catch {
      return false
    }
  }

  private _onMessage(line: string): void {
    if (!this.pending) return
    try {
      const parsed = JSON.parse(line) as { type: string; reason?: string; message?: string }
      const { resolve, timer } = this.pending
      this.pending = null
      clearTimeout(timer)

      if (parsed.type === 'kill') {
        resolve({ action: 'kill', reason: parsed.reason ?? parsed.message })
      } else if (parsed.type === 'pause') {
        resolve({ action: 'pause', reason: parsed.reason })
      } else {
        resolve({ action: 'proceed' })
      }
    } catch {
      // Malformed response — proceed
      this._resolvePendingWithProceed()
    }
  }

  private _resolvePendingWithProceed(): void {
    if (!this.pending) return
    const { resolve, timer } = this.pending
    this.pending = null
    clearTimeout(timer)
    resolve({ action: 'proceed' })
  }

  private _scheduleReconnect(): void {
    if (this.closed) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectMs = Math.min(this.reconnectMs * 2, RECONNECT_MAX_MS)
      this._connect()
    }, this.reconnectMs)
  }
}
