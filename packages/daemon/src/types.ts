/** Daemon-specific types for Fuze AI Phase 3. */

export interface RunConfig {
  maxCostPerRun?: number
  maxIterations?: number
  model?: string
}

export interface StepData {
  stepId: string
  stepNumber: number
  toolName: string
  argsHash: string
  sideEffect: boolean
  startedAt: string
  hasSideEffect?: boolean
}

export interface StepMetadata {
  costUsd: number
  tokensIn: number
  tokensOut: number
  latencyMs: number
  error?: string | null
}

export interface GuardEventData {
  eventId: string
  stepId?: string
  eventType: 'loop_detected' | 'budget_exceeded' | 'timeout' | 'side_effect_blocked'
  severity: 'warning' | 'action' | 'critical'
  details: Record<string, unknown>
}

export interface RunState {
  runId: string
  agentId: string
  agentVersion: string
  modelProvider: string
  modelName: string
  status: 'running' | 'completed' | 'failed' | 'killed' | 'budget_exceeded' | 'loop_detected'
  startedAt: string
  totalCost: number
  totalSteps: number
  steps: StepData[]
  guardEvents: GuardEventData[]
  config: RunConfig
  killReason?: string
}

/** DB record types (for AuditStore) */
export interface RunRecord {
  runId: string
  agentId: string
  agentVersion: string
  modelProvider: string
  modelName: string
  status: string
  startedAt: string
  endedAt?: string
  totalCost: number
  totalTokensIn: number
  totalTokensOut: number
  totalSteps: number
  configJson: string
  prevHash: string
  hash: string
}

export interface DbStepRecord {
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
  prevHash: string
  hash: string
}

export interface DbGuardEventRecord {
  eventId: string
  runId: string
  stepId?: string
  timestamp: string
  eventType: string
  severity: string
  detailsJson: string
  prevHash: string
  hash: string
}

export interface BudgetConfig {
  orgDailyBudget: number
  perAgentDailyBudget: number
  alertThreshold: number
}

export interface BudgetDecision {
  action: 'kill'
  reason: string
}

export interface PatternAlert {
  type: 'repeated_failure' | 'cost_spike' | 'reliability_drop'
  agentId: string
  details: Record<string, unknown>
  severity: 'warning' | 'critical'
}

export interface AgentReliability {
  totalRuns: number
  successRate: number
  avgCost: number
  failureHotspot: { step: string; tool: string; count: number } | null
}

export interface AlertConfig {
  dedupWindowMs: number
  webhookUrls?: string[]
}

export interface Alert {
  id: string
  timestamp: string
  type: string
  severity: 'warning' | 'action' | 'critical'
  message: string
  details: Record<string, unknown>
}

export interface DaemonConfig {
  socketPath: string
  apiPort: number
  storagePath: string
  retentionDays: number
  budget: BudgetConfig
  alerts: AlertConfig
}
