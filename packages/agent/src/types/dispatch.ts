import type { RunId } from './brand.js'
import type { PlanStepStatus } from './plan.js'

export type AgentErrorCategory =
  | 'model_error'
  | 'tool_error'
  | 'tool_input_invalid'
  | 'output_invalid'
  | 'guardrail_trip'
  | 'policy_denied'
  | 'budget_exceeded'
  | 'timeout'
  | 'child_error'
  | 'user_abort'
  | 'suspended_pending_approval'

export interface FailureAttribution {
  readonly roleId?: string
  readonly planStepId?: string
  readonly toolName?: string
  readonly modelCallId?: string
}

export interface AgentRunFailure {
  readonly category: AgentErrorCategory
  readonly attribution: FailureAttribution
  readonly message: string
  readonly detailHash?: string
  readonly retriable: boolean
  readonly attempt: number
  readonly childFailure?: AgentRunFailure
}

export type DispatchResult<T> =
  | { readonly ok: true; readonly output: T; readonly runId: RunId; readonly chainRoot: string }
  | { readonly ok: false; readonly failure: AgentRunFailure; readonly runId: RunId; readonly chainRoot: string }

export interface DispatchInputBase {
  readonly task: string
  readonly forwardContext?: readonly string[]
  readonly forward?: readonly ('principal' | 'tenant' | 'subjectRef')[]
  readonly retry?: {
    readonly maxAttempts: number
    readonly backoffMs?: number
  }
}

export const NEVER_RETRY_CATEGORIES: readonly AgentErrorCategory[] = [
  'policy_denied',
  'guardrail_trip',
  'budget_exceeded',
  'user_abort',
] as const

export const isRetriableCategory = (category: AgentErrorCategory): boolean =>
  !NEVER_RETRY_CATEGORIES.includes(category)

export const planStepStatusForFailure = (failure: AgentRunFailure): PlanStepStatus => {
  if (failure.category === 'suspended_pending_approval') return 'blocked'
  return 'failed'
}
