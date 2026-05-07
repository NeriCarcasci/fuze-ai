import type { RunId, StepId } from './brand.js'
import type { DataClassification } from './compliance.js'

export type LedgerEntryKind =
  | 'tool_call'
  | 'model_call'
  | 'human_input'
  | 'dispatch_committed'
  | 'dispatch_completed'
  | 'plan_committed'
  | 'plan_step_updated'
  | 'plan_revised'
  | 'oversight_suspend'
  | 'oversight_resume'

export interface LedgerEntryBase {
  readonly kind: LedgerEntryKind
  readonly runId: RunId
  readonly parentRunId?: RunId
  readonly spanId: string
  readonly parentSpanId?: string
  readonly linkedStepId?: string
  readonly linkageSource?: 'auto' | 'explicit' | 'corrected'
  readonly startedAt: string
  readonly endedAt?: string
  readonly prevHash: string
  readonly entryHash: string
}

export interface ToolCallLedgerEntry extends LedgerEntryBase {
  readonly kind: 'tool_call'
  readonly toolName: string
  readonly toolVersion: string
  readonly toolImplHash: string
  readonly inputHash: string
  readonly outputHash: string
  readonly outputDataClass: DataClassification
  readonly cacheKey: string
  readonly cacheHit: boolean
  readonly randomnessSources: readonly { readonly name: string; readonly value: string }[]
  readonly status: 'ok' | 'error' | 'cached'
  readonly errorClass?: string
  readonly errorMessage?: string
  readonly durationMs: number
}

export type ExpectedDeterminism = 'best-effort' | 'none'

export interface ModelCallLedgerEntry extends LedgerEntryBase {
  readonly kind: 'model_call'
  readonly provider: string
  readonly model: string
  readonly modelSnapshotId: string
  readonly systemFingerprint?: string
  readonly temperature: number
  readonly topP?: number
  readonly topK?: number
  readonly seed?: number
  readonly maxOutputTokens: number
  readonly stopSequences?: readonly string[]
  readonly toolsAvailable: readonly { readonly name: string; readonly version: string }[]
  readonly requestHash: string
  readonly responseHash: string
  readonly promptCacheUsage?: { readonly cachedInputTokens: number }
  readonly usage: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly cachedInputTokens?: number
  }
  readonly latencyMs: number
  readonly expectedDeterminism: ExpectedDeterminism
}

export interface HumanInputLedgerEntry extends LedgerEntryBase {
  readonly kind: 'human_input'
  readonly oversightId: string
  readonly modifierIdentity: string
  readonly modifierMethod: 'dashboard' | 'api' | 'sdk-resume'
  readonly prompt: string
  readonly inputHash: string
  readonly approvalScope?: string
  readonly signedAt: string
  readonly reviewerSignature: string
  readonly rationale?: string
}

export interface DispatchCommittedLedgerEntry extends LedgerEntryBase {
  readonly kind: 'dispatch_committed'
  readonly childRoleName: string
  readonly childRoleHash: string
  readonly childRunId: RunId
  readonly taskHash: string
  readonly viewSelected?: string
  readonly forwardContext: readonly { readonly path: string; readonly sha256: string }[]
  readonly forwarded: readonly ('principal' | 'tenant' | 'subjectRef')[]
}

export interface DispatchCompletedLedgerEntry extends LedgerEntryBase {
  readonly kind: 'dispatch_completed'
  readonly childRunId: RunId
  readonly childChainRoot: string
  readonly outputHash: string
  readonly status: 'ok' | 'error'
  readonly errorCategory?: string
  readonly durationMs: number
  readonly tokensUsed: number
}

export interface OversightSuspendLedgerEntry extends LedgerEntryBase {
  readonly kind: 'oversight_suspend'
  readonly oversightId: string
  readonly reason: 'tool_high_risk' | 'low_confidence' | 'category_change' | 'plan_revision' | 'requires_approval'
  readonly reviewerHint?: string
  readonly evidencePayloadHash: string
  readonly timeoutAt?: string
}

export interface OversightResumeLedgerEntry extends LedgerEntryBase {
  readonly kind: 'oversight_resume'
  readonly oversightId: string
  readonly decision: 'approve' | 'modify' | 'reject' | 'timeout'
  readonly modifiedArgsHash?: string
  readonly humanInputEntryHash: string
  readonly reviewerId?: string
}

export type LedgerEntry =
  | ToolCallLedgerEntry
  | ModelCallLedgerEntry
  | HumanInputLedgerEntry
  | DispatchCommittedLedgerEntry
  | DispatchCompletedLedgerEntry
  | OversightSuspendLedgerEntry
  | OversightResumeLedgerEntry
