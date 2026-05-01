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
import { DefinitionFingerprintMismatchError } from '../src/loop/fingerprint.js'
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
  id: 'multi.test.v1',
  hashTtlDays: 30,
  fullContentTtlDays: 7,
  decisionTtlDays: 90,
}

const makeKeyPair = (): { signer: Ed25519Signer; verifier: Ed25519Verifier } => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const id = 'multi-key'
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

describe('resumeRun — multi-step continuation', () => {
  it('continues with additional tool calls after the approved tool', async () => {
    const initial: ChainedRecord<EvidenceSpan>[] = []
    const continuation: ChainedRecord<EvidenceSpan>[] = []
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
    const lookup = defineTool.public({
      name: 'lookup',
      description: 'cheap public lookup',
      input: z.object({ ref: z.string() }),
      output: z.object({ resolved: z.string() }),
      threatBoundary: TB,
      retention: RET,
      run: async (input) => Ok({ resolved: `OK-${input.ref}` }),
    })

    const initialAgent = defineAgent({
      purpose: 'multi-step-resume',
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
      tools: [sensitive, lookup],
      output: z.object({ result: z.string() }),
      maxSteps: 5,
      retryBudget: 0,
      deps: {},
    })

    const initialResult = await runAgent(
      {
        definition: initialAgent,
        policy: new StaticPolicyEngine([
          { id: 'a', toolName: 'transfer', effect: 'requires-approval' },
          { id: 'b', toolName: 'lookup', effect: 'allow' },
        ]),
        evidenceSink: (r) => initial.push(r),
        signer,
      },
      {
        tenant: makeTenantId('t1'),
        principal: makePrincipalId('p1'),
        secrets: inMemorySecrets({}),
        userMessage: 'transfer 100',
      },
    )
    expect(initialResult.suspended).toBeDefined()

    const continuationAgent = defineAgent({
      ...initialAgent,
      model: fakeModel([
        {
          content: '',
          toolCalls: [{ id: 'c2', name: 'lookup', args: { ref: 'r-42' } }],
          finishReason: 'tool_calls',
          tokensIn: 4,
          tokensOut: 3,
        },
        { content: '{"result":"all done"}', toolCalls: [], finishReason: 'stop', tokensIn: 4, tokensOut: 3 },
      ]),
    })

    const result = await resumeRun(
      {
        definition: continuationAgent,
        policy: new StaticPolicyEngine([{ id: 'c', toolName: '*', effect: 'allow' }]),
        verifier,
        nonceStore: new InMemoryNonceStore(),
        evidenceSink: (r) => continuation.push(r),
      },
      {
        suspended: initialResult.suspended!,
        decision: { action: 'approve', rationale: 'ok', overseerId: 'overseer-1' },
        tenant: makeTenantId('t1'),
        principal: makePrincipalId('p1'),
        secrets: inMemorySecrets({}),
        priorHistory: [{ role: 'user', content: 'transfer 100' }],
        allowDefinitionDrift: true,
      },
    )

    expect(result.status).toBe('completed')
    expect(result.output).toEqual({ result: 'all done' })
    const lookupSpan = continuation.find(
      (r) => r.payload.span === 'tool.execute' && r.payload.attrs['gen_ai.tool.name'] === 'lookup',
    )
    expect(lookupSpan).toBeDefined()
    expect(lookupSpan?.payload.attrs['fuze.continuation']).toBe(true)
  })

  it('refuses resume when definition fingerprint has drifted', async () => {
    const { signer, verifier } = makeKeyPair()
    const tool = defineTool.public({
      name: 'transfer',
      description: 'original description',
      input: z.object({ amount: z.number() }),
      output: z.object({ confirmation: z.string() }),
      threatBoundary: TB,
      retention: RET,
      needsApproval: () => true,
      run: async (input) => Ok({ confirmation: `transferred ${input.amount}` }),
    })
    const original = defineAgent({
      purpose: 'fingerprint',
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model: fakeModel([
        {
          content: '',
          toolCalls: [{ id: 'c1', name: 'transfer', args: { amount: 100 } }],
          finishReason: 'tool_calls',
          tokensIn: 1,
          tokensOut: 1,
        },
      ]),
      tools: [tool],
      output: z.object({}),
      maxSteps: 3,
      retryBudget: 0,
      deps: {},
    })

    const initial = await runAgent(
      {
        definition: original,
        policy: new StaticPolicyEngine([{ id: 'a', toolName: '*', effect: 'requires-approval' }]),
        evidenceSink: () => undefined,
        signer,
      },
      {
        tenant: makeTenantId('t1'),
        principal: makePrincipalId('p1'),
        secrets: inMemorySecrets({}),
        userMessage: 'go',
      },
    )

    const drifted = defineAgent({
      ...original,
      tools: [
        defineTool.public({
          name: 'transfer',
          description: 'CHANGED description — overseer reviewed the original',
          input: z.object({ amount: z.number() }),
          output: z.object({ confirmation: z.string() }),
          threatBoundary: TB,
          retention: RET,
          needsApproval: () => true,
          run: async (input) => Ok({ confirmation: `transferred ${input.amount}` }),
        }),
      ],
    })

    await expect(
      resumeRun(
        {
          definition: drifted,
          policy: new StaticPolicyEngine([{ id: 'a', toolName: '*', effect: 'allow' }]),
          verifier,
          nonceStore: new InMemoryNonceStore(),
          evidenceSink: () => undefined,
        },
        {
          suspended: initial.suspended!,
          decision: { action: 'approve', rationale: 'r', overseerId: 'o' },
          tenant: makeTenantId('t1'),
          principal: makePrincipalId('p1'),
          secrets: inMemorySecrets({}),
          priorHistory: [],
        },
      ),
    ).rejects.toBeInstanceOf(DefinitionFingerprintMismatchError)
  })

  it('allows drift when allowDefinitionDrift is true', async () => {
    const { signer, verifier } = makeKeyPair()
    const tool = defineTool.public({
      name: 'transfer',
      description: 'original',
      input: z.object({ amount: z.number() }),
      output: z.object({ confirmation: z.string() }),
      threatBoundary: TB,
      retention: RET,
      needsApproval: () => true,
      run: async (input) => Ok({ confirmation: `transferred ${input.amount}` }),
    })
    const original = defineAgent({
      purpose: 'drift-allowed',
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model: fakeModel([
        {
          content: '',
          toolCalls: [{ id: 'c1', name: 'transfer', args: { amount: 100 } }],
          finishReason: 'tool_calls',
          tokensIn: 1,
          tokensOut: 1,
        },
      ]),
      tools: [tool],
      output: z.object({}),
      maxSteps: 3,
      retryBudget: 0,
      deps: {},
    })
    const initial = await runAgent(
      {
        definition: original,
        policy: new StaticPolicyEngine([{ id: 'a', toolName: '*', effect: 'requires-approval' }]),
        evidenceSink: () => undefined,
        signer,
      },
      {
        tenant: makeTenantId('t1'),
        principal: makePrincipalId('p1'),
        secrets: inMemorySecrets({}),
        userMessage: 'go',
      },
    )

    const drifted = defineAgent({
      ...original,
      model: fakeModel([
        { content: '{}', toolCalls: [], finishReason: 'stop', tokensIn: 1, tokensOut: 1 },
      ]),
      tools: [
        defineTool.public({
          name: 'transfer',
          description: 'CHANGED',
          input: z.object({ amount: z.number() }),
          output: z.object({ confirmation: z.string() }),
          threatBoundary: TB,
          retention: RET,
          needsApproval: () => true,
          run: async (input) => Ok({ confirmation: `transferred ${input.amount}` }),
        }),
      ],
    })

    const result = await resumeRun(
      {
        definition: drifted,
        policy: new StaticPolicyEngine([{ id: 'a', toolName: '*', effect: 'allow' }]),
        verifier,
        nonceStore: new InMemoryNonceStore(),
        evidenceSink: () => undefined,
      },
      {
        suspended: initial.suspended!,
        decision: { action: 'approve', rationale: 'r', overseerId: 'o' },
        tenant: makeTenantId('t1'),
        principal: makePrincipalId('p1'),
        secrets: inMemorySecrets({}),
        priorHistory: [],
        allowDefinitionDrift: true,
      },
    )
    expect(result.status).toBe('completed')
  })
})
