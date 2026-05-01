import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { generateKeyPairSync, sign, verify } from 'node:crypto'
import { defineAgent } from '../src/agent/define-agent.js'
import { defineTool } from '../src/agent/define-tool.js'
import { inMemorySecrets } from '../src/agent/secrets-noop.js'
import { runAgent } from '../src/loop/loop.js'
import { resumeRun } from '../src/loop/resume.js'
import { InMemoryNonceStore } from '../src/loop/in-memory-stores.js'
import { StaticPolicyEngine } from '../src/policy/static.js'
import { verifyChain } from '../src/evidence/hash-chain.js'
import type { ChainedRecord } from '../src/evidence/hash-chain.js'
import type { EvidenceSpan } from '../src/evidence/emitter.js'
import type { FuzeModel, ModelStep } from '../src/types/model.js'
import type { ThreatBoundary, RetentionPolicy } from '../src/types/compliance.js'
import type { Ed25519Signer, Ed25519Verifier } from '../src/types/signing.js'
import { Ok } from '../src/types/result.js'
import { makeTenantId, makePrincipalId } from '../src/types/brand.js'

const TB: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

const RET: RetentionPolicy = {
  id: 'resume.test.v1',
  hashTtlDays: 30,
  fullContentTtlDays: 7,
  decisionTtlDays: 90,
}

const makeKeyPair = (): { signer: Ed25519Signer; verifier: Ed25519Verifier } => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const id = 'resume-key'
  return {
    signer: { publicKeyId: id, sign: async (m) => sign(null, Buffer.from(m), privateKey) },
    verifier: {
      verify: async (kid, m, s) => kid === id && verify(null, Buffer.from(m), publicKey, Buffer.from(s)),
    },
  }
}

const fakeModel = (steps: ModelStep[]): FuzeModel => {
  let i = 0
  return {
    providerName: 'fake',
    modelName: 'fake-1',
    residency: 'eu',
    generate: async () => {
      const s = steps[i++]
      if (!s) throw new Error('exhausted')
      return s
    },
  }
}

describe('resumeRun', () => {
  it('completes a suspended run after approval, chain remains valid across suspend', async () => {
    const initialRecords: ChainedRecord<EvidenceSpan>[] = []
    const continuationRecords: ChainedRecord<EvidenceSpan>[] = []
    const { signer, verifier } = makeKeyPair()

    const sensitive = defineTool.public({
      name: 'transfer',
      description: 'sensitive op',
      input: z.object({ amount: z.number() }),
      output: z.object({ confirmation: z.string() }),
      threatBoundary: TB,
      retention: RET,
      needsApproval: () => true,
      run: async (input) => Ok({ confirmation: `transferred ${input.amount}` }),
    })

    const initialAgent = defineAgent({
      purpose: 'resume-test',
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model: fakeModel([
        {
          content: '',
          toolCalls: [{ id: 'c1', name: 'transfer', args: { amount: 100 } }],
          finishReason: 'tool_calls',
          tokensIn: 5,
          tokensOut: 5,
        },
      ]),
      tools: [sensitive],
      output: z.object({ result: z.string() }),
      maxSteps: 3,
      retryBudget: 0,
      deps: {},
    })

    const initial = await runAgent(
      {
        definition: initialAgent,
        policy: new StaticPolicyEngine([{ id: 'a', toolName: 'transfer', effect: 'requires-approval' }]),
        evidenceSink: (r) => initialRecords.push(r),
        signer,
      },
      {
        tenant: makeTenantId('t1'),
        principal: makePrincipalId('p1'),
        secrets: inMemorySecrets({}),
        userMessage: 'transfer 100',
      },
    )
    expect(initial.status).toBe('suspended')
    expect(initial.suspended).toBeDefined()
    expect(verifyChain(initialRecords)).toBe(true)

    const resumeAgent = defineAgent({
      purpose: 'resume-test',
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model: fakeModel([
        { content: '{"result":"done"}', toolCalls: [], finishReason: 'stop', tokensIn: 5, tokensOut: 5 },
      ]),
      tools: [sensitive],
      output: z.object({ result: z.string() }),
      maxSteps: 3,
      retryBudget: 0,
      deps: {},
    })

    const nonceStore = new InMemoryNonceStore()
    const result = await resumeRun(
      {
        definition: resumeAgent,
        policy: new StaticPolicyEngine([{ id: 'a', toolName: '*', effect: 'allow' }]),
        verifier,
        nonceStore,
        evidenceSink: (r) => continuationRecords.push(r),
      },
      {
        suspended: initial.suspended!,
        decision: {
          action: 'approve',
          rationale: 'within budget',
          overseerId: 'overseer-1',
          trainingId: 'cert-2026',
        },
        tenant: makeTenantId('t1'),
        principal: makePrincipalId('p1'),
        secrets: inMemorySecrets({}),
        priorHistory: [{ role: 'user', content: 'transfer 100' }],
      },
    )

    expect(result.status).toBe('completed')
    expect(result.output).toEqual({ result: 'done' })
    expect(continuationRecords.length).toBeGreaterThanOrEqual(3)
    const oversight = continuationRecords.find((r) => r.payload.span === 'oversight.decision')
    expect(oversight).toBeDefined()
    const approved = continuationRecords.find((r) => r.payload.span === 'tool.execute.approved')
    expect(approved).toBeDefined()
    const continuation = continuationRecords.find(
      (r) => r.payload.span === 'model.generate' && r.payload.attrs['fuze.continuation'] === true,
    )
    expect(continuation).toBeDefined()
  })

  it('treats reject as a tripwire halt without executing the tool', async () => {
    const initialRecords: ChainedRecord<EvidenceSpan>[] = []
    const continuationRecords: ChainedRecord<EvidenceSpan>[] = []
    const { signer, verifier } = makeKeyPair()
    let toolRan = false

    const sensitive = defineTool.public({
      name: 'transfer',
      description: 't',
      input: z.object({ amount: z.number() }),
      output: z.object({ confirmation: z.string() }),
      threatBoundary: TB,
      retention: RET,
      needsApproval: () => true,
      run: async () => {
        toolRan = true
        return Ok({ confirmation: 'ok' })
      },
    })

    const agent = defineAgent({
      purpose: 'reject-test',
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model: fakeModel([
        {
          content: '',
          toolCalls: [{ id: 'c1', name: 'transfer', args: { amount: 100 } }],
          finishReason: 'tool_calls',
          tokensIn: 5,
          tokensOut: 5,
        },
      ]),
      tools: [sensitive],
      output: z.object({ result: z.string() }),
      maxSteps: 3,
      retryBudget: 0,
      deps: {},
    })

    const initial = await runAgent(
      {
        definition: agent,
        policy: new StaticPolicyEngine([{ id: 'a', toolName: 'transfer', effect: 'requires-approval' }]),
        evidenceSink: (r) => initialRecords.push(r),
        signer,
      },
      {
        tenant: makeTenantId('t1'),
        principal: makePrincipalId('p1'),
        secrets: inMemorySecrets({}),
        userMessage: 'transfer 100',
      },
    )
    expect(initial.suspended).toBeDefined()

    const result = await resumeRun(
      {
        definition: agent,
        policy: new StaticPolicyEngine([{ id: 'a', toolName: '*', effect: 'allow' }]),
        verifier,
        nonceStore: new InMemoryNonceStore(),
        evidenceSink: (r) => continuationRecords.push(r),
      },
      {
        suspended: initial.suspended!,
        decision: { action: 'reject', rationale: 'unauthorised', overseerId: 'overseer-1' },
        tenant: makeTenantId('t1'),
        principal: makePrincipalId('p1'),
        secrets: inMemorySecrets({}),
        priorHistory: [{ role: 'user', content: 'transfer 100' }],
      },
    )
    expect(result.status).toBe('tripwire')
    expect(toolRan).toBe(false)
    const oversight = continuationRecords.find((r) => r.payload.span === 'oversight.decision')
    expect(oversight?.payload.attrs['fuze.oversight.action']).toBe('reject')
  })

  it('uses overrideArgs in continuation when decision is override', async () => {
    const initialRecords: ChainedRecord<EvidenceSpan>[] = []
    const continuationRecords: ChainedRecord<EvidenceSpan>[] = []
    const { signer, verifier } = makeKeyPair()
    let observedAmount = -1

    const sensitive = defineTool.public({
      name: 'transfer',
      description: 't',
      input: z.object({ amount: z.number() }),
      output: z.object({ confirmation: z.string(), amount: z.number() }),
      threatBoundary: TB,
      retention: RET,
      needsApproval: () => true,
      run: async (input) => {
        observedAmount = input.amount
        return Ok({ confirmation: 'ok', amount: input.amount })
      },
    })

    const agent = defineAgent({
      purpose: 'override-test',
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model: fakeModel([
        {
          content: '',
          toolCalls: [{ id: 'c1', name: 'transfer', args: { amount: 5000 } }],
          finishReason: 'tool_calls',
          tokensIn: 5,
          tokensOut: 5,
        },
      ]),
      tools: [sensitive],
      output: z.object({ result: z.string() }),
      maxSteps: 3,
      retryBudget: 0,
      deps: {},
    })

    const initial = await runAgent(
      {
        definition: agent,
        policy: new StaticPolicyEngine([{ id: 'a', toolName: 'transfer', effect: 'requires-approval' }]),
        evidenceSink: (r) => initialRecords.push(r),
        signer,
      },
      {
        tenant: makeTenantId('t1'),
        principal: makePrincipalId('p1'),
        secrets: inMemorySecrets({}),
        userMessage: 'transfer big',
      },
    )

    const continuation = defineAgent({
      ...agent,
      model: fakeModel([
        { content: '{"result":"done"}', toolCalls: [], finishReason: 'stop', tokensIn: 5, tokensOut: 5 },
      ]),
    })

    const result = await resumeRun(
      {
        definition: continuation,
        policy: new StaticPolicyEngine([{ id: 'a', toolName: '*', effect: 'allow' }]),
        verifier,
        nonceStore: new InMemoryNonceStore(),
        evidenceSink: (r) => continuationRecords.push(r),
      },
      {
        suspended: initial.suspended!,
        decision: {
          action: 'override',
          rationale: 'reduce amount',
          overseerId: 'overseer-1',
          overrideArgs: { amount: 100 },
        },
        tenant: makeTenantId('t1'),
        principal: makePrincipalId('p1'),
        secrets: inMemorySecrets({}),
        priorHistory: [{ role: 'user', content: 'transfer big' }],
      },
    )

    expect(result.status).toBe('completed')
    expect(observedAmount).toBe(100)
  })
})
