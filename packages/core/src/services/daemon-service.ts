import * as net from 'node:net'
import * as os from 'node:os'
import * as path from 'node:path'
import type { FuzeService, ToolRegistration, ToolConfig, StepCheckData, StepEndData, GuardEventData } from './types.js'

const STEP_TIMEOUT_MS = 10
const CONFIG_TIMEOUT_MS = 2_000
const RECONNECT_BASE_MS = 100
const RECONNECT_MAX_MS = 5_000

export function getDefaultSocketPath(): string {
  return process.platform === 'win32'
    ? '\\\\.\\pipe\\fuze-daemon'
    : path.join(os.tmpdir(), 'fuze-daemon.sock')
}

interface PendingStep {
  resolve: (value: 'proceed' | 'kill' | 'pause') => void
  timer: ReturnType<typeof setTimeout>
}

interface PendingConfig {
  resolve: (tools: Record<string, ToolConfig>) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

/**
 * DaemonService — talks to the user's local Fuze daemon over UDS / named pipe.
 *
 * Config: sends get_config at connect() time and populates in-memory cache.
 * Step checks use a 10ms timeout, falling back to 'proceed'.
 */
export class DaemonService implements FuzeService {
  private readonly _configCache = new Map<string, ToolConfig>()
  private _socket: net.Socket | null = null
  private _buf = ''
  private _pendingStep: PendingStep | null = null
  private _pendingConfig: PendingConfig | null = null
  private _reconnectMs = RECONNECT_BASE_MS
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private _closed = false
  private _connected = false

  constructor(private readonly socketPath: string = getDefaultSocketPath()) {}

  async connect(): Promise<boolean> {
    this._connect()
    // Wait briefly for initial connection
    await new Promise<void>(resolve => setTimeout(resolve, 50))
    if (this._connected) {
      await this.refreshConfig()
    }
    return this._connected
  }

  disconnect(): void {
    this._closed = true
    if (this._reconnectTimer) clearTimeout(this._reconnectTimer)
    if (this._socket) { this._socket.destroy(); this._socket = null }
    this._connected = false
  }

  isConnected(): boolean { return this._connected }

  // ── Configuration ──────────────────────────────────────────────────────────

  async registerTools(projectId: string, tools: ToolRegistration[]): Promise<void> {
    this._send({ type: 'register_tools', projectId, tools })
  }

  getToolConfig(toolName: string): ToolConfig | null {
    return this._configCache.get(toolName) ?? null
  }

  async refreshConfig(): Promise<void> {
    if (!this._socket || this._socket.destroyed) return
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this._pendingConfig = null
        resolve()
      }, CONFIG_TIMEOUT_MS)

      this._pendingConfig = {
        resolve: (tools) => {
          this._configCache.clear()
          for (const [name, cfg] of Object.entries(tools)) {
            this._configCache.set(name, cfg)
          }
          resolve()
        },
        reject: () => resolve(),
        timer,
      }

      const sent = this._send({ type: 'get_config' })
      if (!sent) {
        clearTimeout(timer)
        this._pendingConfig = null
        resolve()
      }
    })
  }

  // ── Telemetry ──────────────────────────────────────────────────────────────

  async sendRunStart(runId: string, agentId: string, _config: object): Promise<void> {
    this._send({ type: 'run_start', runId, agentId })
  }

  async sendStepStart(runId: string, step: StepCheckData): Promise<'proceed' | 'kill' | 'pause'> {
    if (!this._socket || this._socket.destroyed) return 'proceed'

    return new Promise<'proceed' | 'kill' | 'pause'>((resolve) => {
      const timer = setTimeout(() => {
        this._pendingStep = null
        resolve('proceed')
      }, STEP_TIMEOUT_MS)

      this._pendingStep = { resolve, timer }

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
        this._pendingStep = null
        resolve('proceed')
      }
    })
  }

  async sendStepEnd(runId: string, stepId: string, data: StepEndData): Promise<void> {
    this._send({ type: 'step_end', runId, stepId, ...data, error: data.error ?? null })
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

  // ── Private ────────────────────────────────────────────────────────────────

  private _connect(): void {
    if (this._closed) return

    const sock = net.createConnection(this.socketPath)
    this._socket = sock
    this._buf = ''

    sock.on('connect', () => {
      this._connected = true
      this._reconnectMs = RECONNECT_BASE_MS
    })

    sock.on('data', (chunk: Buffer) => {
      this._buf += chunk.toString('utf8')
      const lines = this._buf.split('\n')
      this._buf = lines.pop() ?? ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (trimmed) this._onMessage(trimmed)
      }
    })

    sock.on('error', () => { /* handled by 'close' */ })

    sock.on('close', () => {
      this._socket = null
      this._connected = false
      this._resolvePendingStepWithProceed()
      this._scheduleReconnect()
    })
  }

  private _send(msg: Record<string, unknown>): boolean {
    if (!this._socket || this._socket.destroyed) return false
    try {
      this._socket.write(JSON.stringify(msg) + '\n')
      return true
    } catch {
      return false
    }
  }

  private _onMessage(line: string): void {
    try {
      const parsed = JSON.parse(line) as { type: string; tools?: Record<string, ToolConfig>; reason?: string }

      if (parsed.type === 'config' && this._pendingConfig) {
        const { resolve, timer } = this._pendingConfig
        this._pendingConfig = null
        clearTimeout(timer)
        resolve(parsed.tools ?? {})
        return
      }

      if (this._pendingStep) {
        const { resolve, timer } = this._pendingStep
        this._pendingStep = null
        clearTimeout(timer)
        if (parsed.type === 'kill') resolve('kill')
        else if (parsed.type === 'pause') resolve('pause')
        else resolve('proceed')
      }
    } catch {
      this._resolvePendingStepWithProceed()
    }
  }

  private _resolvePendingStepWithProceed(): void {
    if (!this._pendingStep) return
    const { resolve, timer } = this._pendingStep
    this._pendingStep = null
    clearTimeout(timer)
    resolve('proceed')
  }

  private _scheduleReconnect(): void {
    if (this._closed) return
    this._reconnectTimer = setTimeout(() => {
      this._reconnectMs = Math.min(this._reconnectMs * 2, RECONNECT_MAX_MS)
      this._connect()
    }, this._reconnectMs)
  }
}
