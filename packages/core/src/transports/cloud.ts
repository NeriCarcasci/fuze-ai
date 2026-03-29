import type { TelemetryTransport, StepCheckData, StepEndData, GuardEventData } from './types.js'

const STEP_CHECK_TIMEOUT_MS = 50  // Never block the agent more than 50ms
const FLUSH_INTERVAL_MS = 1_000
const MAX_BUFFER_SIZE = 10_000

interface BufferedEvent {
  type: string
  run_id: string
  [key: string]: unknown
}

/**
 * CloudTransport — sends telemetry to api.fuze-ai.tech over HTTPS.
 *
 * Step checks (sendStepStart) are synchronous with a 50ms timeout — the agent
 * never blocks for longer regardless of cloud latency.
 *
 * Everything else is batched in memory and flushed every second (or immediately
 * on sendRunEnd). Events are never lost unless the buffer exceeds 10K entries.
 */
export class CloudTransport implements TelemetryTransport {
  private buffer: BufferedEvent[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private _connected = false

  constructor(
    private readonly apiKey: string,
    private readonly endpoint: string = 'https://api.fuze-ai.tech',
  ) {}

  async connect(): Promise<boolean> {
    try {
      const res = await fetch(`${this.endpoint}/v1/health`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      })
      if (res.ok) {
        this._connected = true
        this.flushTimer = setInterval(() => { void this._flush() }, FLUSH_INTERVAL_MS)
        return true
      }
      return false
    } catch {
      return false
    }
  }

  async sendRunStart(runId: string, agentId: string, config: object): Promise<void> {
    this._enqueue({ type: 'run_start', run_id: runId, agent_id: agentId, config })
  }

  async sendStepStart(runId: string, step: StepCheckData): Promise<'proceed' | 'kill' | 'pause'> {
    try {
      const res = await fetch(`${this.endpoint}/v1/step/check`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ run_id: runId, step }),
        signal: AbortSignal.timeout(STEP_CHECK_TIMEOUT_MS),
      })
      const body = await res.json() as { decision?: string }
      const decision = body.decision
      if (decision === 'kill' || decision === 'pause') return decision
      return 'proceed'
    } catch {
      // Never block the agent if cloud is slow or down
      return 'proceed'
    }
  }

  async sendStepEnd(runId: string, stepId: string, data: StepEndData): Promise<void> {
    this._enqueue({ type: 'step_end', run_id: runId, step_id: stepId, ...data })
  }

  async sendGuardEvent(runId: string, event: GuardEventData): Promise<void> {
    this._enqueue({ type: 'guard_event', run_id: runId, ...event })
  }

  async sendRunEnd(runId: string, status: string, totalCost: number): Promise<void> {
    this._enqueue({ type: 'run_end', run_id: runId, status, total_cost: totalCost })
    await this._flush()
  }

  isConnected(): boolean { return this._connected }

  disconnect(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    void this._flush()
    this._connected = false
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _enqueue(event: BufferedEvent): void {
    if (this.buffer.length < MAX_BUFFER_SIZE) {
      this.buffer.push(event)
    }
  }

  private async _flush(): Promise<void> {
    if (!this.buffer.length) return
    const events = [...this.buffer]
    this.buffer = []
    try {
      await fetch(`${this.endpoint}/v1/events`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ events }),
      })
    } catch {
      // Re-queue failed events (up to buffer limit)
      if (this.buffer.length + events.length <= MAX_BUFFER_SIZE) {
        this.buffer.unshift(...events)
      }
    }
  }
}
