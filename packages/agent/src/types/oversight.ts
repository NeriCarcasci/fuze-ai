import type { RunId, StepId } from './brand.js'
import type { SignedRunRoot } from './signing.js'

export type ApprovalAction = 'approve' | 'reject' | 'halt' | 'override'

export interface ResumeToken {
  readonly runId: RunId
  readonly suspendedAtSequence: number
  readonly chainHeadAtSuspend: string
  readonly nonce: string
  readonly signature: string
  readonly publicKeyId: string
}

export interface SuspendedRun {
  readonly runId: RunId
  readonly suspendedAtSpanId: StepId
  readonly suspendedAtSequence: number
  readonly chainHeadAtSuspend: string
  readonly toolName: string
  readonly toolArgs: Readonly<Record<string, unknown>>
  readonly reason: string
  readonly resumeToken: ResumeToken
  readonly definitionFingerprint: string
  /** Captured at suspend so the resume path can detect model drift. */
  readonly modelSnapshotAtSuspend?: {
    readonly providerName: string
    readonly modelName: string
    readonly residency: string
  }
  /** True iff the agent's producesArt22Decision was set at suspend time.
   *  Determines whether snapshot drift on resume blocks (refuse) or warns. */
  readonly art22AtSuspend?: boolean
}

export interface ResumeDecision {
  readonly action: ApprovalAction
  readonly rationale: string
  readonly overseerId: string
  readonly trainingId?: string
  readonly overrideArgs?: Readonly<Record<string, unknown>>
}

export interface ResumeInput {
  readonly resumeToken: ResumeToken
  readonly decision: ResumeDecision
}

export class ResumeTokenInvalidError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResumeTokenInvalidError'
  }
}

export class ResumeTokenReplayError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResumeTokenReplayError'
  }
}

export interface ResumeTokenStore {
  has(nonce: string): Promise<boolean>
  consume(nonce: string): Promise<void>
}

export interface SuspendStore {
  save(run: SuspendedRun): Promise<void>
  load(runId: RunId): Promise<SuspendedRun | null>
  markResumed(runId: RunId, decision: ResumeDecision): Promise<void>
  eraseBySubjectRef(subjectHmac: string): Promise<number>
}

export const finalRunRoot = (root: SignedRunRoot): SignedRunRoot => root
