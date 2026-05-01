import { randomUUID } from 'node:crypto'
import type {
  ResumeToken,
  OversightDecision,
  ResumeTokenStore,
  SuspendedRun,
} from '../types/oversight.js'
import type { Ed25519Verifier } from '../types/signing.js'
import type { EvidenceEmitter } from '../evidence/emitter.js'
import { makeStepId } from '../types/brand.js'
import { verifyResumeToken, consumeResumeToken, decisionFingerprint } from './suspend.js'

export interface EvaluateApprovalDeps {
  readonly verifier: Ed25519Verifier
  readonly nonceStore: ResumeTokenStore
  readonly emitter: EvidenceEmitter
  readonly clock?: () => Date
}

export interface ApprovalOutcome {
  readonly continued: boolean
  readonly action: OversightDecision['action']
  readonly emittedSpanSequence: number
  readonly overrideArgs?: Readonly<Record<string, unknown>>
}

export const evaluateApproval = async (
  deps: EvaluateApprovalDeps,
  input: {
    readonly suspended: SuspendedRun
    readonly token: ResumeToken
    readonly decision: OversightDecision
  },
): Promise<ApprovalOutcome> => {
  const clock = deps.clock ?? (() => new Date())
  const startedAt = clock().toISOString()

  if (input.token.runId !== input.suspended.runId) {
    throw new Error('resume token runId mismatch')
  }
  if (input.token.chainHeadAtSuspend !== input.suspended.chainHeadAtSuspend) {
    throw new Error('resume token chainHead mismatch')
  }

  await verifyResumeToken({
    token: input.token,
    verifier: deps.verifier,
    nonceStore: deps.nonceStore,
  })
  await consumeResumeToken({ token: input.token, nonceStore: deps.nonceStore })

  const stepId = makeStepId(randomUUID())
  const record = deps.emitter.emit({
    span: 'oversight.decision',
    role: 'guardrail',
    stepId,
    startedAt,
    endedAt: clock().toISOString(),
    attrs: {
      'fuze.oversight.action': input.decision.action,
      'fuze.oversight.overseer_id': input.decision.overseerId,
      'fuze.oversight.training_id': input.decision.trainingId ?? '',
      'fuze.oversight.fingerprint': decisionFingerprint(input.decision),
      'fuze.oversight.suspended_at_sequence': input.suspended.suspendedAtSequence,
      'fuze.oversight.tool_name': input.suspended.toolName,
    },
    content: { rationale: input.decision.rationale },
  })

  const continued = input.decision.action === 'approve' || input.decision.action === 'override'
  return {
    continued,
    action: input.decision.action,
    emittedSpanSequence: record.sequence,
    ...(input.decision.overrideArgs ? { overrideArgs: input.decision.overrideArgs } : {}),
  }
}
