/** JSON-over-newline protocol for SDK ↔ Daemon communication. */

// ── Shared types ──────────────────────────────────────────────────────────────

export interface ToolRegistration {
  name: string
  description?: string
  schema?: object
  sideEffect: boolean
  defaults: { maxRetries: number; maxBudget: number; timeout: number }
}

export interface ToolConfig {
  maxRetries: number
  maxBudget: number
  timeout: number
  enabled: boolean
  updatedAt: string
}

// ── SDK → Daemon ──────────────────────────────────────────────────────────────

export interface RunStartMessage {
  type: 'run_start'
  runId: string
  agentId: string
  agentVersion?: string
  modelProvider?: string
  modelName?: string
  config?: Record<string, unknown>
}

export interface RunEndMessage {
  type: 'run_end'
  runId: string
  status: 'completed' | 'failed' | 'killed' | 'budget_exceeded' | 'loop_detected'
  totalCost: number
}

export interface StepStartMessage {
  type: 'step_start'
  runId: string
  stepId: string
  stepNumber: number
  toolName: string
  argsHash: string
  sideEffect: boolean
}

export interface StepEndMessage {
  type: 'step_end'
  runId: string
  stepId: string
  costUsd: number
  tokensIn: number
  tokensOut: number
  latencyMs: number
  error?: string | null
}

export interface GuardEventMessage {
  type: 'guard_event'
  runId: string
  stepId?: string
  eventType: 'loop_detected' | 'budget_exceeded' | 'timeout' | 'side_effect_blocked'
  severity: 'warning' | 'action' | 'critical'
  details: Record<string, unknown>
}

export interface RegisterToolsMessage {
  type: 'register_tools'
  projectId: string
  tools: ToolRegistration[]
}

export interface GetConfigMessage {
  type: 'get_config'
  toolName?: string
}

export type SDKMessage = RunStartMessage | RunEndMessage | StepStartMessage | StepEndMessage | GuardEventMessage | RegisterToolsMessage | GetConfigMessage

// ── Daemon → SDK ──────────────────────────────────────────────────────────────

export interface ProceedResponse { type: 'proceed' }
export interface KillResponse    { type: 'kill';  reason: string; message: string }
export interface PauseResponse   { type: 'pause'; reason: string; approvalId: string }
export interface RetryResponse   { type: 'retry'; context: string }
export interface ConfigResponse  { type: 'config'; tools: Record<string, ToolConfig> }
export interface ErrorResponse   { type: 'error'; message: string }

export type DaemonResponse = ProceedResponse | KillResponse | PauseResponse | RetryResponse | ConfigResponse | ErrorResponse

const REQUIRED_FIELDS: Record<string, string[]> = {
  run_start:       ['runId', 'agentId'],
  run_end:         ['runId', 'status', 'totalCost'],
  step_start:      ['runId', 'stepId', 'stepNumber', 'toolName', 'argsHash'],
  step_end:        ['runId', 'stepId', 'costUsd', 'tokensIn', 'tokensOut', 'latencyMs'],
  guard_event:     ['runId', 'eventType', 'severity'],
  register_tools:  ['projectId', 'tools'],
  get_config:      [],
}

const KNOWN_TYPES = new Set(Object.keys(REQUIRED_FIELDS))

/**
 * Parse a raw JSON string into a typed SDKMessage.
 *
 * @param raw - A single line of JSON (without trailing newline).
 * @throws Error if the JSON is invalid or required fields are missing.
 */
export function parseMessage(raw: string): SDKMessage {
  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>
  } catch (err) {
    throw new Error(`Protocol: malformed JSON — ${(err as Error).message}`)
  }

  const type = parsed['type'] as string
  if (!KNOWN_TYPES.has(type)) {
    throw new Error(`Protocol: unknown message type '${type}'`)
  }

  const required = REQUIRED_FIELDS[type]
  const missing = required.filter((f) => !(f in parsed))
  if (missing.length > 0) {
    throw new Error(`Protocol: message type '${type}' missing required fields: ${missing.join(', ')}`)
  }

  return parsed as unknown as SDKMessage
}

/**
 * Serialise a DaemonResponse to a single-line JSON string with trailing newline.
 *
 * @param response - The response to serialise.
 * @returns JSON string terminated with '\n'.
 */
export function serialiseResponse(response: DaemonResponse): string {
  return JSON.stringify(response) + '\n'
}

/** Convenience factory for a proceed response. */
export const PROCEED: ProceedResponse = { type: 'proceed' }
