// Types matching the daemon API responses

export interface RunRecord {
  runId: string
  agentId: string
  agentVersion: string
  modelProvider: string
  modelName: string
  status: 'running' | 'completed' | 'failed' | 'killed' | 'budget_exceeded' | 'loop_detected'
  startedAt: string
  endedAt?: string
  totalCost: number
  totalTokensIn: number
  totalTokensOut: number
  totalSteps: number
  configJson: string
}

export interface StepRecord {
  stepId: string
  runId: string
  stepNumber: number
  startedAt: string
  endedAt?: string
  toolName: string
  argsHash: string
  hasSideEffect: number
  costUsd: number
  tokensIn: number
  tokensOut: number
  latencyMs: number
  error?: string | null
}

export interface GuardEvent {
  eventId: string
  runId: string
  stepId?: string
  timestamp: string
  eventType: string
  severity: 'warning' | 'action' | 'critical'
  detailsJson: string
}

export interface CompensationRecord {
  compensationId: string
  runId: string
  stepId: string
  toolName: string
  originalResultJson: string | null
  compensationStatus: 'pending' | 'succeeded' | 'failed' | 'no_compensation' | 'skipped'
  compensationStartedAt: string | null
  compensationEndedAt: string | null
  compensationError: string | null
  escalated: boolean
}

export interface RunsResponse {
  runs: RunRecord[]
  total: number
}

export interface RunDetailResponse {
  run: RunRecord
  steps: StepRecord[]
  guardEvents: GuardEvent[]
}

export interface BudgetResponse {
  org: { dailySpend: number; dailyBudget: number; runningAgents: number }
  agents: Record<string, { spent: number; budget: number }>
}

export interface AgentHealthResponse {
  agentId: string
  reliability: {
    totalRuns: number
    successRate: number
    avgCost: number
    failureHotspot: { step: string; tool: string; count: number } | null
  }
  spend: { spent: number; budget: number }
}

export interface RollbackResult {
  totalSteps: number
  compensated: number
  failed: number
  noCompensation: number
  skipped: number
  details: CompensationRecord[]
}

export interface IncidentReport {
  reportVersion: string
  generatedAt: string
  systemId: string
  run: RunRecord & { model: string }
  traceSummary: { totalSteps: number; sideEffectSteps: number; guardEvents: number; criticalEvents: number }
  actions: { stepId: string; toolName: string; startedAt: string; endedAt?: string; costUsd: number; hasSideEffect: boolean; error?: string | null }[]
  sideEffects: { stepId: string; toolName: string; argsHash: string }[]
  compensation: { compensationId: string; stepId: string; toolName: string; status: string; error?: string | null; escalated: boolean }[]
  guardEvents: { eventId: string; eventType: string; severity: string; timestamp: string; details: unknown }[]
  humanOversight: { killSwitchAvailable: boolean; killSwitchUsed: boolean; loopDetectionEnabled: boolean; budgetEnforcementEnabled: boolean }
  auditIntegrity: { totalRecords: number; oldestRecord: string }
}

const BASE = ''

async function apiFetch<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts?.headers },
    ...opts,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string }
    throw new Error(err.error ?? `HTTP ${res.status}`)
  }
  return res.json() as Promise<T>
}

export async function fetchRuns(params?: { status?: string; agentId?: string; limit?: number }): Promise<RunsResponse> {
  const q = new URLSearchParams()
  if (params?.status) q.set('status', params.status)
  if (params?.agentId) q.set('agentId', params.agentId)
  if (params?.limit) q.set('limit', String(params.limit))
  return apiFetch<RunsResponse>(`/api/runs?${q}`)
}

export async function fetchRun(runId: string): Promise<RunDetailResponse> {
  return apiFetch<RunDetailResponse>(`/api/runs/${runId}`)
}

export async function killRun(runId: string): Promise<void> {
  await apiFetch<{ ok: boolean }>(`/api/runs/${runId}/kill`, { method: 'POST' })
}

export async function fetchBudget(): Promise<BudgetResponse> {
  return apiFetch<BudgetResponse>('/api/budget')
}

export async function fetchAgentHealth(agentId: string): Promise<AgentHealthResponse> {
  return apiFetch<AgentHealthResponse>(`/api/agents/${agentId}/health`)
}

export async function fetchCompensation(runId: string): Promise<CompensationRecord[]> {
  const data = await apiFetch<{ runId: string; records: CompensationRecord[] }>(`/api/runs/${runId}/compensation`)
  return data.records
}

export async function triggerRollback(runId: string): Promise<RollbackResult> {
  return apiFetch<RollbackResult>(`/api/runs/${runId}/rollback`, { method: 'POST' })
}

export async function generateIncidentReport(runId: string): Promise<IncidentReport> {
  return apiFetch<IncidentReport>(`/api/compliance/report/${runId}`)
}
