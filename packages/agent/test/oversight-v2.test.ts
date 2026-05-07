import { describe, expect, it, vi } from 'vitest'
import { InMemoryDurableAdapter } from '../src/oversight/durable-adapter.js'
import { requestOversight } from '../src/oversight/request-oversight.js'
import { resolveOversight } from '../src/oversight/resolve-oversight.js'
import { makeRunId } from '../src/types/brand.js'
import type { OversightRequest, OversightDecision } from '../src/types/oversight-v2.js'

const RUN = makeRunId('run_test_oversight')

const noopEmitters = () => {
  const suspends: Array<{ request: OversightRequest; payloadHash: string }> = []
  const resumes: Array<{ request: OversightRequest; decision: OversightDecision<unknown>; entryHash: string }> = []
  return {
    suspends,
    resumes,
    emitSuspendEvent: (request: OversightRequest, payloadHash: string) => {
      suspends.push({ request, payloadHash })
    },
    emitResumeEvent: (request: OversightRequest, decision: OversightDecision<unknown>, entryHash: string) => {
      resumes.push({ request, decision, entryHash })
    },
  }
}

describe('requestOversight + resolveOversight', () => {
  it('round-trips an approve decision and emits suspend + resume events', async () => {
    const adapter = new InMemoryDurableAdapter()
    const e = noopEmitters()
    const oversightPromise = requestOversight(
      { adapter, emitSuspendEvent: e.emitSuspendEvent, emitResumeEvent: e.emitResumeEvent },
      {
        runId: RUN,
        reason: 'tool_high_risk',
        evidence: { tool: 'send_email' },
        reviewerHint: 'team-compliance',
      },
    )
    // Resolver runs externally; pluck the awakeable id from the InMemory adapter.
    await new Promise((r) => setImmediate(r))
    expect(adapter.pendingCount()).toBe(1)
    // The InMemory adapter doesn't expose its IDs directly; tests resolve via direct adapter call.
    // To keep the test honest, we use the only pending id: shape is `awk_<oversightId>_<n>`.
    const id = (adapter as unknown as { pending: Map<string, unknown> }).pending.keys().next().value as string
    await resolveOversight(adapter, {
      awakeableId: id,
      decision: 'approve',
      reviewerId: 'reviewer-42',
      reviewerSignature: 'sig-bytes',
    })
    const decision = await oversightPromise
    expect(decision.decision).toBe('approve')
    expect(decision.reviewerId).toBe('reviewer-42')
    expect(e.suspends).toHaveLength(1)
    expect(e.resumes).toHaveLength(1)
    expect(e.suspends[0]!.payloadHash).toMatch(/^[a-f0-9]{64}$/)
    expect(e.resumes[0]!.entryHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('round-trips a modify decision carrying modifiedArgs', async () => {
    const adapter = new InMemoryDurableAdapter()
    const e = noopEmitters()
    const oversightPromise = requestOversight<{ subject: string }>(
      { adapter, emitSuspendEvent: e.emitSuspendEvent, emitResumeEvent: e.emitResumeEvent },
      {
        runId: RUN,
        reason: 'requires_approval',
        evidence: { kind: 'send-email' },
        proposedArgs: { subject: 'original' },
      },
    )
    await new Promise((r) => setImmediate(r))
    const id = (adapter as unknown as { pending: Map<string, unknown> }).pending.keys().next().value as string
    await resolveOversight(adapter, {
      awakeableId: id,
      decision: 'modify',
      modifiedArgs: { subject: 'reviewer-edited' },
      reviewerId: 'reviewer-42',
    })
    const decision = await oversightPromise
    expect(decision.decision).toBe('modify')
    expect(decision.modifiedArgs).toEqual({ subject: 'reviewer-edited' })
  })

  it('refuses modify without modifiedArgs', async () => {
    const adapter = new InMemoryDurableAdapter()
    await expect(
      resolveOversight(adapter, { awakeableId: 'fake', decision: 'modify' }),
    ).rejects.toThrow(/modifiedArgs/)
  })

  it('times out when no resolution arrives in time', async () => {
    vi.useFakeTimers()
    try {
      const adapter = new InMemoryDurableAdapter()
      const e = noopEmitters()
      const promise = requestOversight(
        { adapter, emitSuspendEvent: e.emitSuspendEvent, emitResumeEvent: e.emitResumeEvent },
        {
          runId: RUN,
          reason: 'low_confidence',
          evidence: {},
          timeoutMs: 100,
        },
      )
      await vi.advanceTimersByTimeAsync(150)
      const decision = await promise
      expect(decision.decision).toBe('timeout')
      expect(e.resumes[0]!.decision.decision).toBe('timeout')
    } finally {
      vi.useRealTimers()
    }
  })
})
