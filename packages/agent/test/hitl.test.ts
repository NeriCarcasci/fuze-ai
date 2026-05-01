import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { generateKeyPairSync, sign, verify } from 'node:crypto'
import { defineAgent } from '../src/agent/define-agent.js'
import { defineTool } from '../src/agent/define-tool.js'
import { inMemorySecrets } from '../src/agent/secrets-noop.js'
import { runAgent } from '../src/loop/loop.js'
import { evaluateApproval } from '../src/loop/approval.js'
import { InMemoryNonceStore } from '../src/loop/in-memory-stores.js'
import { StaticPolicyEngine } from '../src/policy/static.js'
import { EvidenceEmitter } from '../src/evidence/emitter.js'
import { verifyChain } from '../src/evidence/hash-chain.js'
import type { Ed25519Signer, Ed25519Verifier } from '../src/types/signing.js'
import type { ChainedRecord } from '../src/evidence/hash-chain.js'
import type { EvidenceSpan } from '../src/evidence/emitter.js'
import type { FuzeModel, ModelStep } from '../src/types/model.js'
import type { ThreatBoundary, RetentionPolicy } from '../src/types/compliance.js'
import { Ok } from '../src/types/result.js'
import { makeTenantId, makePrincipalId, makeRunId } from '../src/types/brand.js'
import { ResumeTokenInvalidError, ResumeTokenReplayError } from '../src/types/oversight.js'

const TB: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

const RET: RetentionPolicy = {
  id: 'hitl.test.v1',
  hashTtlDays: 30,
  fullContentTtlDays: 7,
  decisionTtlDays: 90,
}

interface KeyPair {
  signer: Ed25519Signer
  verifier: Ed25519Verifier
}

const makeKeyPair = (): KeyPair => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const id = 'test-key-1'
  const signer: Ed25519Signer = {
    publicKeyId: id,
    sign: async (msg) => sign(null, Buffer.from(msg), privateKey),
  }
  const verifier: Ed25519Verifier = {
    verify: async (kid, msg, sig) => kid === id && verify(null, Buffer.from(msg), publicKey, Buffer.from(sig)),
  }
  return { signer, verifier }
}

const fakeModel = (steps: ModelStep[]): FuzeModel => {
  let i = 0
  return {
    providerName: 'fake',
    modelName: 'fake-1',
    residency: 'eu',
    generate: async () => {
      const s = steps[i++]
      if (!s) throw new Error('fakeModel exhausted')
      return s
    },
  }
}

const sensitiveTool = defineTool.public({
  name: 'sensitive',
  description: 'requires approval',
  input: z.object({ payload: z.string() }),
  output: z.object({ done: z.boolean() }),
  threatBoundary: TB,
  retention: RET,
  needsApproval: () => true,
  run: async () => Ok({ done: true }),
})

describe('HITL suspend/resume', () => {
  it('suspends with a SuspendedRun and a valid resume token', async () => {
    const records: ChainedRecord<EvidenceSpan>[] = []
    const { signer } = makeKeyPair()
    const agent = defineAgent({
      purpose: 'hitl-suspend',
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model: fakeModel([
        {
          content: '',
          toolCalls: [{ id: 'c1', name: 'sensitive', args: { payload: 'x' } }],
          finishReason: 'tool_calls',
          tokensIn: 1,
          tokensOut: 1,
        },
      ]),
      tools: [sensitiveTool],
      output: z.object({}),
      maxSteps: 3,
      retryBudget: 0,
      deps: {},
    })

    const result = await runAgent(
      {
        definition: agent,
        policy: new StaticPolicyEngine([
          { id: 'approve.sensitive', toolName: 'sensitive', effect: 'requires-approval' },
        ]),
        evidenceSink: (r) => records.push(r),
        signer,
      },
      {
        tenant: makeTenantId('t-1'),
        principal: makePrincipalId('p-1'),
        secrets: inMemorySecrets({}),
        userMessage: 'do it',
      },
    )

    expect(result.status).toBe('suspended')
    expect(result.suspended).toBeDefined()
    expect(result.suspended?.toolName).toBe('sensitive')
    expect(result.suspended?.resumeToken.signature.length).toBeGreaterThan(0)
    expect(verifyChain(records)).toBe(true)
  })

  it('errors out cleanly if signer is missing on requires-approval', async () => {
    const records: ChainedRecord<EvidenceSpan>[] = []
    const agent = defineAgent({
      purpose: 'hitl-no-signer',
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model: fakeModel([
        {
          content: '',
          toolCalls: [{ id: 'c1', name: 'sensitive', args: { payload: 'x' } }],
          finishReason: 'tool_calls',
          tokensIn: 1,
          tokensOut: 1,
        },
      ]),
      tools: [sensitiveTool],
      output: z.object({}),
      maxSteps: 3,
      retryBudget: 0,
      deps: {},
    })

    const result = await runAgent(
      {
        definition: agent,
        policy: new StaticPolicyEngine([
          { id: 'approve.sensitive', toolName: 'sensitive', effect: 'requires-approval' },
        ]),
        evidenceSink: (r) => records.push(r),
      },
      {
        tenant: makeTenantId('t-1'),
        principal: makePrincipalId('p-1'),
        secrets: inMemorySecrets({}),
        userMessage: 'do it',
      },
    )
    expect(result.status).toBe('error')
    expect(result.reason).toContain('signer')
  })

  it('evaluateApproval verifies a valid token, consumes nonce, emits decision span', async () => {
    const records: ChainedRecord<EvidenceSpan>[] = []
    const { signer, verifier } = makeKeyPair()
    const agent = defineAgent({
      purpose: 'hitl-resume',
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model: fakeModel([
        {
          content: '',
          toolCalls: [{ id: 'c1', name: 'sensitive', args: { payload: 'x' } }],
          finishReason: 'tool_calls',
          tokensIn: 1,
          tokensOut: 1,
        },
      ]),
      tools: [sensitiveTool],
      output: z.object({}),
      maxSteps: 3,
      retryBudget: 0,
      deps: {},
    })
    const result = await runAgent(
      {
        definition: agent,
        policy: new StaticPolicyEngine([
          { id: 'approve.sensitive', toolName: 'sensitive', effect: 'requires-approval' },
        ]),
        evidenceSink: (r) => records.push(r),
        signer,
      },
      {
        tenant: makeTenantId('t-1'),
        principal: makePrincipalId('p-1'),
        secrets: inMemorySecrets({}),
        userMessage: 'do it',
      },
    )
    expect(result.suspended).toBeDefined()

    const downstream: ChainedRecord<EvidenceSpan>[] = []
    const emitter = new EvidenceEmitter({
      tenant: makeTenantId('t-1'),
      principal: makePrincipalId('p-1'),
      runId: makeRunId(result.runId),
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      retention: RET,
      captureFullContent: false,
      sink: (r) => downstream.push(r),
    })
    const nonceStore = new InMemoryNonceStore()
    const outcome = await evaluateApproval(
      { verifier, nonceStore, emitter },
      {
        suspended: result.suspended!,
        token: result.suspended!.resumeToken,
        decision: {
          action: 'approve',
          rationale: 'overseer reviewed and approved',
          overseerId: 'overseer-99',
          trainingId: 'cert-ai-act-2025-q1',
        },
      },
    )

    expect(outcome.continued).toBe(true)
    expect(outcome.action).toBe('approve')
    const decisionSpan = downstream.find((r) => r.payload.span === 'oversight.decision')
    expect(decisionSpan).toBeDefined()
    expect(decisionSpan?.payload.attrs['fuze.oversight.action']).toBe('approve')
    expect(decisionSpan?.payload.attrs['fuze.oversight.training_id']).toBe('cert-ai-act-2025-q1')
  })

  it('rejects a replayed resume token', async () => {
    const records: ChainedRecord<EvidenceSpan>[] = []
    const { signer, verifier } = makeKeyPair()
    const agent = defineAgent({
      purpose: 'hitl-replay',
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model: fakeModel([
        {
          content: '',
          toolCalls: [{ id: 'c1', name: 'sensitive', args: { payload: 'x' } }],
          finishReason: 'tool_calls',
          tokensIn: 1,
          tokensOut: 1,
        },
      ]),
      tools: [sensitiveTool],
      output: z.object({}),
      maxSteps: 3,
      retryBudget: 0,
      deps: {},
    })
    const result = await runAgent(
      {
        definition: agent,
        policy: new StaticPolicyEngine([
          { id: 'approve.sensitive', toolName: 'sensitive', effect: 'requires-approval' },
        ]),
        evidenceSink: (r) => records.push(r),
        signer,
      },
      {
        tenant: makeTenantId('t-1'),
        principal: makePrincipalId('p-1'),
        secrets: inMemorySecrets({}),
        userMessage: 'do it',
      },
    )
    const downstream: ChainedRecord<EvidenceSpan>[] = []
    const emitter = new EvidenceEmitter({
      tenant: makeTenantId('t-1'),
      principal: makePrincipalId('p-1'),
      runId: makeRunId(result.runId),
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      retention: RET,
      captureFullContent: false,
      sink: (r) => downstream.push(r),
    })
    const nonceStore = new InMemoryNonceStore()
    const decision = {
      action: 'approve' as const,
      rationale: 'first time',
      overseerId: 'overseer-1',
    }
    await evaluateApproval(
      { verifier, nonceStore, emitter },
      { suspended: result.suspended!, token: result.suspended!.resumeToken, decision },
    )
    await expect(
      evaluateApproval(
        { verifier, nonceStore, emitter },
        { suspended: result.suspended!, token: result.suspended!.resumeToken, decision },
      ),
    ).rejects.toBeInstanceOf(ResumeTokenReplayError)
  })

  it('rejects a token signed with a different key', async () => {
    const records: ChainedRecord<EvidenceSpan>[] = []
    const realKp = makeKeyPair()
    const wrongKp = makeKeyPair()
    const agent = defineAgent({
      purpose: 'hitl-wrong-key',
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model: fakeModel([
        {
          content: '',
          toolCalls: [{ id: 'c1', name: 'sensitive', args: { payload: 'x' } }],
          finishReason: 'tool_calls',
          tokensIn: 1,
          tokensOut: 1,
        },
      ]),
      tools: [sensitiveTool],
      output: z.object({}),
      maxSteps: 3,
      retryBudget: 0,
      deps: {},
    })
    const result = await runAgent(
      {
        definition: agent,
        policy: new StaticPolicyEngine([
          { id: 'approve.sensitive', toolName: 'sensitive', effect: 'requires-approval' },
        ]),
        evidenceSink: (r) => records.push(r),
        signer: realKp.signer,
      },
      {
        tenant: makeTenantId('t-1'),
        principal: makePrincipalId('p-1'),
        secrets: inMemorySecrets({}),
        userMessage: 'do it',
      },
    )
    const downstream: ChainedRecord<EvidenceSpan>[] = []
    const emitter = new EvidenceEmitter({
      tenant: makeTenantId('t-1'),
      principal: makePrincipalId('p-1'),
      runId: makeRunId(result.runId),
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      retention: RET,
      captureFullContent: false,
      sink: (r) => downstream.push(r),
    })
    const nonceStore = new InMemoryNonceStore()
    await expect(
      evaluateApproval(
        { verifier: wrongKp.verifier, nonceStore, emitter },
        {
          suspended: result.suspended!,
          token: result.suspended!.resumeToken,
          decision: {
            action: 'approve',
            rationale: 'forged',
            overseerId: 'attacker',
          },
        },
      ),
    ).rejects.toBeInstanceOf(ResumeTokenInvalidError)
  })
})
