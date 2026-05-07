import type { RunId } from './brand.js'

export type PlanStepStatus =
  | 'pending'
  | 'in_progress'
  | 'done'
  | 'blocked'
  | 'superseded'
  | 'failed'
  | 'skipped'

export type LinkageSource = 'auto' | 'explicit' | 'corrected'

export interface PlanStepLifecycle {
  readonly createdAt: string
  readonly startedAt?: string
  readonly suspendedAt?: string
  readonly resumedAt?: string
  readonly endedAt?: string
}

export interface PlanStep {
  readonly stepId: string
  readonly ordinal: number
  readonly content: string
  readonly activeForm: string
  readonly status: PlanStepStatus
  readonly lifecycle: PlanStepLifecycle
  readonly parentStepId?: string
  readonly derivedFrom?: readonly string[]
  readonly evidenceRefs: readonly string[]
  readonly note?: string
}

export interface PlanVersion {
  readonly version: number
  readonly createdAt: string
  readonly steps: readonly PlanStep[]
  readonly planHash: string
  readonly prevPlanHash?: string
  readonly rationale?: string
}

export type PlanEventKind =
  | 'plan_committed'
  | 'plan_step_updated'
  | 'plan_revised'

export interface PlanCommittedEvent {
  readonly kind: 'plan_committed'
  readonly version: 1
  readonly planHash: string
  readonly runId: RunId
  readonly steps: readonly PlanStep[]
}

export interface PlanStepUpdatedEvent {
  readonly kind: 'plan_step_updated'
  readonly version: number
  readonly stepId: string
  readonly from: PlanStepStatus
  readonly to: PlanStepStatus
  readonly evidenceRefs: readonly string[]
  readonly linkageSource: LinkageSource
  readonly note?: string
  readonly deltaHash: string
  readonly prevHash: string
}

export interface PlanRevisedEvent {
  readonly kind: 'plan_revised'
  readonly version: number
  readonly planHash: string
  readonly prevHash: string
  readonly rationale: string
  readonly added: readonly string[]
  readonly removed: readonly string[]
  readonly reordered: readonly string[]
}

export type PlanEvent =
  | PlanCommittedEvent
  | PlanStepUpdatedEvent
  | PlanRevisedEvent

export interface PlanCommitInput {
  readonly steps: ReadonlyArray<{
    readonly content: string
    readonly activeForm: string
    readonly parentStepId?: string
  }>
}

export interface PlanStepUpdateInput {
  readonly stepId: string
  readonly status: PlanStepStatus
  readonly evidenceRefs?: readonly string[]
  readonly unlinkRefs?: readonly string[]
  readonly note?: string
}

export interface PlanReviseInput {
  readonly addSteps?: ReadonlyArray<{
    readonly stepId?: string
    readonly parentStepId?: string
    readonly derivedFrom?: readonly string[]
    readonly ordinal: number
    readonly content: string
    readonly activeForm: string
  }>
  readonly removeSteps?: readonly string[]
  readonly reorder?: ReadonlyArray<{ readonly stepId: string; readonly ordinal: number }>
  readonly rationale: string
}

export interface AutoCaptureContext {
  readonly currentStepId: string | null
  readonly version: number
}
