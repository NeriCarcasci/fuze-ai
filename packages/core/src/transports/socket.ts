import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import type { TelemetryTransport, StepCheckData, StepEndData, GuardEventData } from './types.js'

const STEP_TIMEOUT_MS = 10
const RECONNECT_BASE_MS = 100
const RECONNECT_MAX_MS = 5_000

export function getDefaultSocketPath(): string {
  return process.platform === 'win32'
    ? '\\\\.\\pipe\\fuze-daemon'
    : path.join(os.tmpdir(), 'fuze-daemon.sock')
}

interface PendingRequest {
  resolve: (value: 'proceed' | 'kill' | 'pause') => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * SocketTransport — talks to the user's local Fuze daemon over a Unix Domain Socket
 * (or Windows named pipe). Falls back to 'proceed' within 10ms if the daemon is
 * unavailable so the agent is never blocked by a dead socket.
 */
export class SocketTransport implements TelemetryTransport {
  private socket: net.Socket | null = null
  private buf = ''
  private pending: PendingRequest | null = null
  private reconnectMs = RECONNECT_BASE_MS
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private closed = false
  private connected = false

  constructor(private readonly socketPath: string = getDefaultSocketPath()) {
    this._connect()
  }

  async connect(): Promise<boolean> {
    // Connection is initiated in constructor; this is a no-op status check
    return this.connected
  }

  async sendRunStart(runId: string, agentId: string, _config: object): Promise<void> {
    this._send({ type: 'run_start', runId, agentId })
  }

  async sendStepStart(runId: string, step: StepCheckData): Promise<'proceed' | 'kill' | 'pause'> {
    if (!this.socket || this.socket.destroyed) return 'proceed'

    return new Promise<'proceed' | 'kill' | 'pause'>((resolve) => {
      const timer = setTimeout(() => {
        this.pending = null
        resolve('proceed')
      }, STEP_TIMEOUT_MS)

      this.pending = { resolve, timer }

      const sent = this._send({
        type: 'step_start',
        runId,
        stepId: step.stepId,
        stepNumber: step.stepNumber,
        toolName: step.toolName,
        argsHash: step.argsHash,
        sideEffect: step.sideEffect,
      })

      if (!sent) {
        clearTimeout(timer)
        this.pending = null
        resolve('proceed')
      }
    })
  }

  async sendStepEnd(runId: string, stepId: string, data: StepEndData): Promise<void> {
    this._send({
      type: 'step_end',
      runId,
      stepId,
      costUsd: data.costUsd,
      tokensIn: data.tokensIn,
      tokensOut: data.tokensOut,
      latencyMs: data.latencyMs,
      error: data.error ?? null,
    })
  }

  async sendGuardEvent(runId: string, event: GuardEventData): Promise<void> {
    this._send({
      type: 'guard_event',
      runId,
      stepId: event.stepId,
      eventType: event.eventType,
      severity: event.severity,
      details: event.details,
    })
  }

  async sendRunEnd(runId: string, status: string, totalCost: number): Promise<void> {
    this._send({ type: 'run_end', runId, status, totalCost })
  }

  isConnected(): boolean { return this.connected }

  disconnect(): void {
    this.closed = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
    this.connected = false
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _connect(): void {
    if (this.closed) return

    const sock = net.createConnection(this.socketPath)
    this.socket = sock
    this.buf = ''

    sock.on('connect', () => {
      this.connected = true
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
      // Handled by 'close'
    })

    sock.on('close', () => {
      this.socket = null
      this.connected = false
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
        resolve('kill')
      } else if (parsed.type === 'pause') {
        resolve('pause')
      } else {
        resolve('proceed')
      }
    } catch {
      this._resolvePendingWithProceed()
    }
  }

  private _resolvePendingWithProceed(): void {
    if (!this.pending) return
    const { resolve, timer } = this.pending
    this.pending = null
    clearTimeout(timer)
    resolve('proceed')
  }

  private _scheduleReconnect(): void {
    if (this.closed) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectMs = Math.min(this.reconnectMs * 2, RECONNECT_MAX_MS)
      this._connect()
    }, this.reconnectMs)
  }
}
