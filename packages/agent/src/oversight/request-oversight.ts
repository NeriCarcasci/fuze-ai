/**
 * requestOversight — the Article 14 inline-suspend primitive.
 *
 * Inside a tool or step, the agent calls requestOversight(). The runtime:
 *   1. Mints an oversightId.
 *   2. Emits an oversight_suspend ledger entry (hashed into the chain).
 *   3. Creates a durable awakeable via the adapter.
 *   4. Awaits the awakeable until a reviewer resolves it externally.
 *   5. Emits an oversight_resume ledger entry referencing the human_input
 *      entry that carries the reviewer's signature.
 *   6. Returns the decision to the caller.
 *
 * Skeleton scope: the contract is concrete; wiring to EvidenceEmitter and a
 * real durable substrate is a follow-up. Tests use InMemoryDurableAdapter.
 */

import { createHash } from 'node:crypto'
import { canonicalize } from '../evidence/canonical.js'
import type { RunId } from '../types/brand.js'
import type {
  DurableExecutionAdapter,
  OversightDecision,
  OversightReason,
  OversightRequest,
} from '../types/oversight-v2.js'

const sha256 = (s: string): string =>
  createHash('sha256').update(s).digest('hex')

const mintOversightId = (runId: RunId, reason: OversightReason): string => {
  const seed = `${runId}|${reason}|${Date.now().toString(36)}|${Math.random().toString(36).slice(2)}`
  return `ovs_${sha256(seed).slice(0, 16)}`
}

export interface RequestOversightDeps {
  readonly adapter: DurableExecutionAdapter
  readonly emitSuspendEvent: (request: OversightRequest, evidencePayloadHash: string) => Promise<void> | void
  readonly emitResumeEvent: (
    request: OversightRequest,
    decision: OversightDecision<unknown>,
    humanInputEntryHash: string,
  ) => Promise<void> | void
  readonly clock?: () => string
}

export interface RequestOversightInput<TArgs = unknown> {
  readonly runId: RunId
  readonly reason: OversightReason
  readonly evidence: Readonly<Record<string, unknown>>
  readonly reviewerHint?: string
  readonly timeoutMs?: number
  readonly proposedArgs?: TArgs
}

export const requestOversight = async <TArgs = unknown>(
  deps: RequestOversightDeps,
  input: RequestOversightInput<TArgs>,
): Promise<OversightDecision<TArgs>> => {
  const clock = deps.clock ?? (() => new Date().toISOString())
  const oversightId = mintOversightId(input.runId, input.reason)
  const createdAt = clock()

  const request: OversightRequest = {
    oversightId,
    runId: input.runId,
    reason: input.reason,
    evidence: input.evidence,
    ...(input.reviewerHint !== undefined ? { reviewerHint: input.reviewerHint } : {}),
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    createdAt,
  }

  const evidencePayloadHash = sha256(
    canonicalize({
      reason: input.reason,
      evidence: input.evidence,
      proposedArgs: input.proposedArgs ?? null,
    }),
  )

  await deps.emitSuspendEvent(request, evidencePayloadHash)

  const { id: awakeableId, promise } = await deps.adapter.createAwakeable<OversightDecision<TArgs>>({
    oversightId,
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
  })

  let decision: OversightDecision<TArgs>
  try {
    decision = await promise
  } catch (err) {
    decision = {
      decision: 'timeout',
      resolvedAt: clock(),
      ...(err instanceof Error ? { rationale: err.message } : {}),
    }
  }

  // Bind awakeableId into the decision audit so the chain can prove which
  // durable promise carried the resolution.
  const humanInputEntryHash = sha256(
    canonicalize({
      oversightId,
      awakeableId,
      decision: decision.decision,
      modifiedArgs: decision.modifiedArgs ?? null,
      reviewerId: decision.reviewerId ?? null,
      reviewerSignature: decision.reviewerSignature ?? null,
      resolvedAt: decision.resolvedAt,
    }),
  )

  await deps.emitResumeEvent(request, decision as OversightDecision<unknown>, humanInputEntryHash)

  return decision
}
