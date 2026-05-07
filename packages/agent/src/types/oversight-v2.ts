/**
 * Article 14 oversight v2 — extends existing oversight.ts.
 *
 * The existing oversight.ts handles single-shot suspend/resume via tokens.
 * This module adds the ctx.requestOversight() pattern: a durable awakeable
 * that the agent awaits inline, resolved later by a human reviewer through
 * an external channel.
 *
 * The runtime substrate is pluggable via DurableExecutionAdapter so Restate,
 * Inngest, Trigger.dev, or an in-memory test impl all satisfy the contract.
 */

import type { RunId } from './brand.js'

export type OversightReason =
  | 'tool_high_risk'
  | 'low_confidence'
  | 'category_change'
  | 'plan_revision'
  | 'requires_approval'

export interface OversightRequest {
  readonly oversightId: string
  readonly runId: RunId
  readonly reason: OversightReason
  readonly evidence: Readonly<Record<string, unknown>>
  readonly reviewerHint?: string
  readonly timeoutMs?: number
  readonly createdAt: string
}

export type OversightDecisionKind = 'approve' | 'modify' | 'reject' | 'timeout'

export interface OversightDecision<TArgs = unknown> {
  readonly decision: OversightDecisionKind
  readonly modifiedArgs?: TArgs
  readonly rationale?: string
  readonly reviewerId?: string
  readonly reviewerSignature?: string
  readonly resolvedAt: string
}

export interface ReviewerSignature {
  readonly reviewerId: string
  readonly algorithm: 'ed25519' | 'jwt-rs256' | 'jwt-es256'
  readonly signature: string
  readonly publicKeyId: string
}

export interface DurableExecutionAdapter {
  readonly createAwakeable: <T>(input: {
    readonly oversightId: string
    readonly timeoutMs?: number
  }) => Promise<{ readonly id: string; readonly promise: Promise<T> }>
  readonly resolveAwakeable: <T>(id: string, value: T) => Promise<void>
  readonly rejectAwakeable: (id: string, reason: string) => Promise<void>
}
