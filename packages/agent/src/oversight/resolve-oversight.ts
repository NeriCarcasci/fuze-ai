/**
 * resolveOversight — the operator-side resolver for a pending oversight.
 *
 * Called from the dashboard / API server when a human reviewer approves,
 * modifies, rejects, or lets the timeout fire on a pending oversight.
 *
 * In production this is mounted on @fuze-ai/agent-api-server; the SDK
 * exposes the function so test harnesses (and InMemory adapters) can drive
 * it directly.
 */

import type {
  DurableExecutionAdapter,
  OversightDecision,
  OversightDecisionKind,
  ReviewerSignature,
} from '../types/oversight-v2.js'

export interface ResolveOversightInput<TArgs = unknown> {
  readonly awakeableId: string
  readonly decision: OversightDecisionKind
  readonly modifiedArgs?: TArgs
  readonly rationale?: string
  readonly reviewerId?: string
  readonly reviewerSignature?: ReviewerSignature | string
  readonly clock?: () => string
}

export const resolveOversight = async <TArgs = unknown>(
  adapter: DurableExecutionAdapter,
  input: ResolveOversightInput<TArgs>,
): Promise<void> => {
  const clock = input.clock ?? (() => new Date().toISOString())

  if (input.decision === 'modify' && input.modifiedArgs === undefined) {
    throw new Error('resolveOversight: decision="modify" requires modifiedArgs.')
  }

  const sig =
    typeof input.reviewerSignature === 'string'
      ? input.reviewerSignature
      : input.reviewerSignature?.signature

  const decision: OversightDecision<TArgs> = {
    decision: input.decision,
    ...(input.modifiedArgs !== undefined ? { modifiedArgs: input.modifiedArgs } : {}),
    ...(input.rationale !== undefined ? { rationale: input.rationale } : {}),
    ...(input.reviewerId !== undefined ? { reviewerId: input.reviewerId } : {}),
    ...(sig !== undefined ? { reviewerSignature: sig } : {}),
    resolvedAt: clock(),
  }

  if (input.decision === 'reject') {
    await adapter.resolveAwakeable<OversightDecision<TArgs>>(input.awakeableId, decision)
    return
  }

  await adapter.resolveAwakeable<OversightDecision<TArgs>>(input.awakeableId, decision)
}
