import type {
  FuzeService,
  ToolRegistration,
  ToolConfig,
  StepCheckData,
  StepEndData,
  GuardEventData,
} from './types.js'

const STEP_CHECK_TIMEOUT_MS = 1_500
const DEFAULT_FLUSH_INTERVAL_MS = 5_000
const MIN_FLUSH_INTERVAL_MS = 1_000
const CONFIG_REFRESH_INTERVAL_MS = 30_000
const CONFIG_CACHE_TTL_MS = 5 * 60_000
const MAX_BUFFER_SIZE = 10_000
const CIRCUIT_BREAKER_FAILURE_THRESHOLD = 3
const CIRCUIT_BREAKER_COOLDOWN_MS = 60_000
const FLUSH_BACKOFF_MIN_MS = 1_000
const FLUSH_BACKOFF_MAX_MS = 30_000

interface BufferedEvent {
  type: string
  run_id: string
  [key: string]: unknown
}

interface ApiServiceOptions {
  endpoint?: string
  flushIntervalMs?: number
}

/**
 * ApiService talks to api.fuze-ai.tech (or custom endpoint) over HTTPS.
 */
export class ApiService implements FuzeService {
  private readonly _configCache = new Map<string, ToolConfig>()
  private readonly _endpoint: string
  private readonly _flushIntervalMs: number
  private _buffer: BufferedEvent[] = []
  private _flushTimer: ReturnType<typeof setInterval> | null = null
  private _refreshTimer: ReturnType<typeof setInterval> | null = null
  private _connected = false
  private _configRefreshedAt = 0
  private _consecutiveFailures = 0
  private _circuitOpenUntil = 0
  private _probeInFlight = false
  private _flushBackoffMs = FLUSH_BACKOFF_MIN_MS
  private _nextFlushAt = 0
  private _beforeExitHandler: (() => void) | null = null

  constructor(
    private readonly apiKey: string,
    options: ApiServiceOptions = {},
  ) {
    this._endpoint = options.endpoint ?? 'https://api.fuze-ai.tech'
    const requested = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS
    this._flushIntervalMs = Math.max(MIN_FLUSH_INTERVAL_MS, requested)
  }

  async connect(): Promise<boolean> {
    if (!this._hasApiKey()) {
      this._connected = false
      return false
    }

    const healthy = await this._request(async () => {
      const res = await fetch(`${this._endpoint}/v1/health`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5_000),
      })
      if (!res.ok) throw new Error(`Health check failed: ${res.status}`)
    })

    if (healthy === null) {
      this._connected = false
      return false
    }

    this._connected = true
    this._flushTimer = setInterval(() => {
      this._runInBackground(this._flushTick())
    }, this._flushIntervalMs)
    this._refreshTimer = setInterval(() => {
      this._runInBackground(this.refreshConfig())
    }, CONFIG_REFRESH_INTERVAL_MS)

    if (!this._beforeExitHandler) {
      this._beforeExitHandler = () => {
        this._runInBackground(this.flush())
      }
      process.once('beforeExit', this._beforeExitHandler)
    }

    await this.refreshConfig(true)
    return true
  }

  async disconnect(): Promise<void> {
    if (this._flushTimer) {
      clearInterval(this._flushTimer)
      this._flushTimer = null
    }
    if (this._refreshTimer) {
      clearInterval(this._refreshTimer)
      this._refreshTimer = null
    }
    if (this._beforeExitHandler) {
      process.off('beforeExit', this._beforeExitHandler)
      this._beforeExitHandler = null
    }

    await this.flush()
    this._connected = false
  }

  isConnected(): boolean {
    return this._connected && !this._isCircuitOpen(Date.now()) && this._hasApiKey()
  }

  async flush(): Promise<void> {
    await this._flushInternal(true)
  }

  async registerTools(projectId: string, tools: ToolRegistration[]): Promise<void> {
    if (!this._hasApiKey()) return

    await this._request(async () => {
      const res = await fetch(`${this._endpoint}/v1/tools/register`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ project_id: projectId, tools }),
        signal: AbortSignal.timeout(5_000),
      })
      if (!res.ok) throw new Error(`Tool registration failed: ${res.status}`)
    })
  }

  getToolConfig(toolName: string): ToolConfig | null {
    return this._configCache.get(toolName) ?? null
  }

  async refreshConfig(force = false): Promise<void> {
    if (!this._hasApiKey()) return
    const now = Date.now()
    if (!force && this._configRefreshedAt > 0 && now - this._configRefreshedAt < CONFIG_CACHE_TTL_MS) {
      return
    }

    const data = await this._request(async () => {
      const res = await fetch(`${this._endpoint}/v1/tools/config`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(5_000),
      })
      if (!res.ok) throw new Error(`Config refresh failed: ${res.status}`)
      return await res.json() as { tools?: Record<string, ToolConfig> } | null
    })

    if (!data?.tools || typeof data.tools !== 'object') return

    this._configCache.clear()
    for (const [name, cfg] of Object.entries(data.tools)) {
      this._configCache.set(name, cfg)
    }
    this._configRefreshedAt = Date.now()
  }

  async sendRunStart(runId: string, agentId: string, config: object): Promise<void> {
    this._enqueue({ type: 'run_start', run_id: runId, agent_id: agentId, config })
  }

  async sendStepStart(runId: string, step: StepCheckData): Promise<'proceed' | 'kill' | 'pause'> {
    if (!this._hasApiKey()) return 'proceed'
    if (this._isCircuitOpen(Date.now())) return 'proceed'

    try {
      const res = await fetch(`${this._endpoint}/v1/step/check`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ run_id: runId, step }),
        signal: AbortSignal.timeout(STEP_CHECK_TIMEOUT_MS),
      })
      if (!res.ok) return 'proceed'
      const body = await res.json() as { decision?: string } | null
      const decision = body?.decision
      if (decision === 'kill' || decision === 'pause') return decision
      return 'proceed'
    } catch {
      return 'proceed'
    }
  }

  async sendStepEnd(runId: string, stepId: string, data: StepEndData): Promise<void> {
    this._enqueue({ type: 'step_end', run_id: runId, step_id: stepId, ...data })
  }

  async sendGuardEvent(runId: string, event: GuardEventData): Promise<void> {
    this._enqueue({ type: 'guard_event', run_id: runId, ...event })
  }

  async sendRunEnd(runId: string, status: string): Promise<void> {
    this._enqueue({ type: 'run_end', run_id: runId, status })
    await this.flush()
  }

  private _enqueue(event: BufferedEvent): void {
    if (!this._hasApiKey()) return
    if (this._buffer.length < MAX_BUFFER_SIZE) {
      this._buffer.push(event)
    }
  }

  private async _flushTick(): Promise<void> {
    await this._flushInternal(false)
  }

  private async _flushInternal(force: boolean): Promise<boolean> {
    if (!this._buffer.length) return true
    if (!this._hasApiKey()) return true
    if (!force && Date.now() < this._nextFlushAt) return false

    const events = [...this._buffer]
    this._buffer = []

    const sent = await this._request(async () => {
      const res = await fetch(`${this._endpoint}/v1/events`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ events }),
      })
      if (!res.ok) throw new Error(`Event flush failed: ${res.status}`)
    })

    if (sent !== null) {
      this._flushBackoffMs = FLUSH_BACKOFF_MIN_MS
      this._nextFlushAt = 0
      return true
    }

    if (this._buffer.length + events.length <= MAX_BUFFER_SIZE) {
      this._buffer.unshift(...events)
    }
    this._nextFlushAt = Date.now() + this._flushBackoffMs
    this._flushBackoffMs = Math.min(this._flushBackoffMs * 2, FLUSH_BACKOFF_MAX_MS)
    return false
  }

  private _hasApiKey(): boolean {
    return this.apiKey.trim().length > 0
  }

  private _isCircuitOpen(now: number): boolean {
    return this._circuitOpenUntil > now
  }

  private _isHalfOpen(now: number): boolean {
    return this._circuitOpenUntil !== 0 && now >= this._circuitOpenUntil
  }

  private _onRequestSuccess(): void {
    this._consecutiveFailures = 0
    this._circuitOpenUntil = 0
  }

  private _onRequestFailure(): void {
    this._consecutiveFailures += 1
    if (this._consecutiveFailures >= CIRCUIT_BREAKER_FAILURE_THRESHOLD) {
      this._consecutiveFailures = CIRCUIT_BREAKER_FAILURE_THRESHOLD
      this._circuitOpenUntil = Date.now() + CIRCUIT_BREAKER_COOLDOWN_MS
    }
  }

  private async _request<T>(operation: () => Promise<T>): Promise<T | null> {
    if (!this._hasApiKey()) return null

    const now = Date.now()
    if (this._isCircuitOpen(now)) return null

    const isProbe = this._isHalfOpen(now)
    if (isProbe && this._probeInFlight) return null
    if (isProbe) this._probeInFlight = true

    try {
      const value = await operation()
      this._onRequestSuccess()
      return value
    } catch {
      this._onRequestFailure()
      return null
    } finally {
      if (isProbe) this._probeInFlight = false
    }
  }

  private _runInBackground(task: Promise<unknown>): void {
    task.catch(() => undefined)
  }
}
