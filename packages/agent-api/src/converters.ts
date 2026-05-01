import {
  makeRunId,
  makeStepId,
  makePrincipalId,
  makeTenantId,
} from '@fuze-ai/agent'
import type {
  ChainedRecord,
  EvidenceSpan,
  OversightDecision,
  ResumeToken,
  SuspendedRun,
} from '@fuze-ai/agent'
import type {
  ChainedRecordWire,
  PostDecisionRequest,
  PostSpansRequest,
  PostSuspendedRunRequest,
} from './schemas.js'

export const toResumeToken = (wire: ChainedRecordWire extends never ? never : PostSuspendedRunRequest['suspendedRun']['resumeToken']): ResumeToken => ({
  runId: makeRunId(wire.runId),
  suspendedAtSequence: wire.suspendedAtSequence,
  chainHeadAtSuspend: wire.chainHeadAtSuspend,
  nonce: wire.nonce,
  signature: wire.signature,
  publicKeyId: wire.publicKeyId,
})

export const toSuspendedRun = (
  wire: PostSuspendedRunRequest['suspendedRun'],
): SuspendedRun => ({
  runId: makeRunId(wire.runId),
  suspendedAtSpanId: makeStepId(wire.suspendedAtSpanId),
  suspendedAtSequence: wire.suspendedAtSequence,
  chainHeadAtSuspend: wire.chainHeadAtSuspend,
  toolName: wire.toolName,
  toolArgs: wire.toolArgs,
  reason: wire.reason,
  resumeToken: toResumeToken(wire.resumeToken),
  definitionFingerprint: wire.definitionFingerprint,
})

export const toOversightDecision = (
  wire: PostDecisionRequest['decision'],
): OversightDecision => {
  const result: { -readonly [K in keyof OversightDecision]?: OversightDecision[K] } = {
    action: wire.action,
    rationale: wire.rationale,
    overseerId: wire.overseerId,
  }
  if (wire.trainingId !== undefined) result.trainingId = wire.trainingId
  if (wire.overrideArgs !== undefined) result.overrideArgs = wire.overrideArgs
  return result as OversightDecision
}

export const toChainedRecord = (
  wire: PostSpansRequest['spans'][number],
): ChainedRecord<EvidenceSpan> => ({
  sequence: wire.sequence,
  prevHash: wire.prevHash,
  hash: wire.hash,
  payload: {
    span: wire.payload.span,
    role: wire.payload.role,
    runId: makeRunId(wire.payload.runId),
    stepId: makeStepId(wire.payload.stepId),
    startedAt: wire.payload.startedAt,
    endedAt: wire.payload.endedAt,
    common: {
      'fuze.tenant.id': makeTenantId(wire.payload.common['fuze.tenant.id']),
      'fuze.principal.id': makePrincipalId(wire.payload.common['fuze.principal.id']),
      'fuze.annex_iii_domain': wire.payload.common['fuze.annex_iii_domain'],
      'fuze.art22_decision': wire.payload.common['fuze.art22_decision'],
      'fuze.retention.policy_id': wire.payload.common['fuze.retention.policy_id'],
      ...(wire.payload.common['fuze.lawful_basis'] !== undefined
        ? { 'fuze.lawful_basis': wire.payload.common['fuze.lawful_basis'] }
        : {}),
      ...(wire.payload.common['fuze.subject.ref'] !== undefined
        ? { 'fuze.subject.ref': wire.payload.common['fuze.subject.ref'] }
        : {}),
    },
    attrs: wire.payload.attrs,
    ...(wire.payload.contentHash !== undefined ? { contentHash: wire.payload.contentHash } : {}),
    ...(wire.payload.contentRef !== undefined ? { contentRef: wire.payload.contentRef } : {}),
  },
})
