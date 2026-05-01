import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { executeApprovedTool } from '../src/loop/execute-approved.js'
import { defineTool } from '../src/agent/define-tool.js'
import { inMemorySecrets } from '../src/agent/secrets-noop.js'
import { EvidenceEmitter } from '../src/evidence/emitter.js'
import type { ChainedRecord } from '../src/evidence/hash-chain.js'
import type { EvidenceSpan } from '../src/evidence/emitter.js'
import type { ThreatBoundary, RetentionPolicy } from '../src/types/compliance.js'
import { Ok, Err, Retry } from '../src/types/result.js'
import type { SuspendedRun, OversightDecision } from '../src/types/oversight.js'
import { makeTenantId, makePrincipalId, makeRunId, makeStepId } from '../src/types/brand.js'

const TB: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

const RET: RetentionPolicy = {
  id: 'exec.test.v1',
  hashTtlDays: 30,
  fullContentTtlDays: 7,
  decisionTtlDays: 90,
}

const buildEmitter = (sink: ChainedRecord<EvidenceSpan>[]): EvidenceEmitter =>
  new EvidenceEmitter({
    tenant: makeTenantId('t1'),
    principal: makePrincipalId('p1'),
    runId: makeRunId('r1'),
    lawfulBasis: 'consent',
    annexIIIDomain: 'none',
    producesArt22Decision: false,
    retention: RET,
    captureFullContent: false,
    sink: (r) => sink.push(r),
  })

const buildSuspended = (toolName: string, args: Record<string, unknown>): SuspendedRun => ({
  runId: makeRunId('r1'),
  suspendedAtSpanId: makeStepId('s1'),
  suspendedAtSequence: 5,
  chainHeadAtSuspend: 'a'.repeat(64),
  toolName,
  toolArgs: args,
  reason: 'awaiting overseer',
  resumeToken: {
    runId: makeRunId('r1'),
    suspendedAtSequence: 5,
    chainHeadAtSuspend: 'a'.repeat(64),
    nonce: 'fixed',
    signature: '',
    publicKeyId: 'k1',
  },
})

const approvedDecision: OversightDecision = {
  action: 'approve',
  rationale: 'overseer reviewed',
  overseerId: 'overseer-1',
}

describe('executeApprovedTool', () => {
  it('runs the tool with original args on approve and emits evidence span', async () => {
    const records: ChainedRecord<EvidenceSpan>[] = []
    const tool = defineTool.public({
      name: 'transfer',
      description: 't',
      input: z.object({ amount: z.number() }),
      output: z.object({ ok: z.boolean() }),
      threatBoundary: TB,
      retention: RET,
      run: async (input) => Ok({ ok: input.amount > 0 }),
    })

    const outcome = await executeApprovedTool(
      {
        tool,
        emitter: buildEmitter(records),
        tenant: makeTenantId('t1'),
        principal: makePrincipalId('p1'),
        secrets: inMemorySecrets({}),
      },
      {
        suspended: buildSuspended('transfer', { amount: 5000 }),
        decision: approvedDecision,
      },
    )

    expect(outcome.executed).toBe(true)
    expect(outcome.output).toEqual({ ok: true })
    const span = records.find((r) => r.payload.span === 'tool.execute.approved')
    expect(span).toBeDefined()
    expect(span?.payload.attrs['fuze.oversight.action']).toBe('approve')
    expect(span?.payload.attrs['fuze.tool.outcome']).toBe('value')
  })

  it('uses overrideArgs when decision is override', async () => {
    const records: ChainedRecord<EvidenceSpan>[] = []
    let observedAmount = -1
    const tool = defineTool.public({
      name: 'transfer',
      description: 't',
      input: z.object({ amount: z.number() }),
      output: z.object({ ok: z.boolean(), amount: z.number() }),
      threatBoundary: TB,
      retention: RET,
      run: async (input) => {
        observedAmount = input.amount
        return Ok({ ok: true, amount: input.amount })
      },
    })

    const outcome = await executeApprovedTool(
      {
        tool,
        emitter: buildEmitter(records),
        tenant: makeTenantId('t1'),
        principal: makePrincipalId('p1'),
        secrets: inMemorySecrets({}),
      },
      {
        suspended: buildSuspended('transfer', { amount: 5000 }),
        decision: {
          action: 'override',
          rationale: 'overseer reduced amount',
          overseerId: 'overseer-1',
          overrideArgs: { amount: 1000 },
        },
      },
    )

    expect(outcome.executed).toBe(true)
    expect(observedAmount).toBe(1000)
    expect((outcome.output as { amount: number }).amount).toBe(1000)
    const span = records.find((r) => r.payload.span === 'tool.execute.approved')
    expect(span?.payload.attrs['fuze.oversight.was_override']).toBe(true)
  })

  it('does not execute on reject', async () => {
    const records: ChainedRecord<EvidenceSpan>[] = []
    let ran = false
    const tool = defineTool.public({
      name: 'transfer',
      description: 't',
      input: z.object({}),
      output: z.object({}),
      threatBoundary: TB,
      retention: RET,
      run: async () => {
        ran = true
        return Ok({})
      },
    })

    const outcome = await executeApprovedTool(
      {
        tool,
        emitter: buildEmitter(records),
        tenant: makeTenantId('t1'),
        principal: makePrincipalId('p1'),
        secrets: inMemorySecrets({}),
      },
      {
        suspended: buildSuspended('transfer', {}),
        decision: { action: 'reject', rationale: 'no', overseerId: 'overseer-1' },
      },
    )
    expect(outcome.executed).toBe(false)
    expect(ran).toBe(false)
  })

  it('refuses when tool name does not match suspended tool', async () => {
    const records: ChainedRecord<EvidenceSpan>[] = []
    const tool = defineTool.public({
      name: 'wrong',
      description: 't',
      input: z.object({}),
      output: z.object({}),
      threatBoundary: TB,
      retention: RET,
      run: async () => Ok({}),
    })
    const outcome = await executeApprovedTool(
      {
        tool,
        emitter: buildEmitter(records),
        tenant: makeTenantId('t1'),
        principal: makePrincipalId('p1'),
        secrets: inMemorySecrets({}),
      },
      {
        suspended: buildSuspended('transfer', {}),
        decision: approvedDecision,
      },
    )
    expect(outcome.executed).toBe(false)
    expect(outcome.reason).toContain('mismatch')
  })

  it('emits an error span when tool returns Retryable', async () => {
    const records: ChainedRecord<EvidenceSpan>[] = []
    const tool = defineTool.public({
      name: 'flaky',
      description: 't',
      input: z.object({}),
      output: z.object({}),
      threatBoundary: TB,
      retention: RET,
      run: async () => Err(Retry('upstream temporarily unavailable')),
    })

    const outcome = await executeApprovedTool(
      {
        tool,
        emitter: buildEmitter(records),
        tenant: makeTenantId('t1'),
        principal: makePrincipalId('p1'),
        secrets: inMemorySecrets({}),
      },
      {
        suspended: buildSuspended('flaky', {}),
        decision: approvedDecision,
      },
    )
    expect(outcome.executed).toBe(false)
    expect(outcome.retryable).toBe(true)
    const span = records.find((r) => r.payload.span === 'tool.execute.approved')
    expect(span?.payload.attrs['fuze.tool.outcome']).toBe('error')
  })
})
