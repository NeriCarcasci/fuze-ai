/**
 * Data for a pre-execution step check sent to the service.
 */
export interface StepCheckData {
  stepId: string
  stepNumber: number
  toolName: string
  argsHash: string
  sideEffect: boolean
}

/**
 * Metadata sent after a step completes.
 */
export interface StepEndData {
  toolName: string
  stepNumber: number
  argsHash: string
  hasSideEffect: boolean
  tokensIn: number
  tokensOut: number
  latencyMs: number
  error?: string | null
}

/**
 * A guard event (loop detected, timeout, etc.).
 */
export interface GuardEventData {
  stepId?: string
  eventType: string
  severity: string
  details: Record<string, unknown>
}

export interface ToolRegistration {
  name: string
  description?: string
  schema?: object
  sideEffect: boolean
  defaults: {
    maxRetries: number
    timeout: number
  }
}

export interface ToolConfig {
  maxRetries: number
  timeout: number
  enabled: boolean
  updatedAt: string
}

/**
 * Unified service interface for runtime telemetry and remote tool configuration.
 * getToolConfig() is intentionally synchronous — it reads from an in-memory
 * cache so the agent's hot path is never blocked by a network call.
 */
export interface FuzeService {
  // ── Lifecycle ──────────────────────────────────────────────────────────────
  connect(): Promise<boolean>
  disconnect(): Promise<void>
  isConnected(): boolean
  flush(): Promise<void>

  // ── Configuration ──────────────────────────────────────────────────────────
  /** Register tool metadata with the API/daemon at SDK boot time. Fire-and-forget. */
  registerTools(projectId: string, tools: ToolRegistration[]): Promise<void>
  /** Synchronous cache read — zero latency on the hot path. Returns null if uncached. */
  getToolConfig(toolName: string): ToolConfig | null
  /** Async pull of latest tool configs from the remote. Updates internal cache. */
  refreshConfig(): Promise<void>

  // ── Telemetry ──────────────────────────────────────────────────────────────
  sendRunStart(runId: string, agentId: string, config: object): Promise<void>
  /**
   * Check whether the step should proceed, be killed, or be paused.
   * Must return within its own internal timeout — never blocks the agent indefinitely.
   */
  sendStepStart(runId: string, step: StepCheckData): Promise<'proceed' | 'kill' | 'pause'>
  sendStepEnd(runId: string, stepId: string, data: StepEndData): Promise<void>
  sendGuardEvent(runId: string, event: GuardEventData): Promise<void>
  sendRunEnd(runId: string, status: string): Promise<void>
}
