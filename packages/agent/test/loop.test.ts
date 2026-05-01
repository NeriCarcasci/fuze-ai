import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineAgent } from '../src/agent/define-agent.js'
import { defineTool } from '../src/agent/define-tool.js'
import { inMemorySecrets } from '../src/agent/secrets-noop.js'
import { runAgent } from '../src/loop/loop.js'
import { StaticPolicyEngine } from '../src/policy/static.js'
import { verifyChain } from '../src/evidence/hash-chain.js'
import type { ChainedRecord } from '../src/evidence/hash-chain.js'
import type { EvidenceSpan } from '../src/evidence/emitter.js'
import type { FuzeModel, ModelStep } from '../src/types/model.js'
import type { ThreatBoundary, RetentionPolicy } from '../src/types/compliance.js'
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
  id: 'test.v1',
  hashTtlDays: 30,
  fullContentTtlDays: 7,
  decisionTtlDays: 90,
}

const echoTool = defineTool.public({
  name: 'echo',
  description: 'echoes input',
  input: z.object({ text: z.string() }),
  output: z.object({ text: z.string() }),
  threatBoundary: TB,
  retention: RET,
  run: async (input) => Ok({ text: input.text }),
})

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

describe('runAgent — loop spine', () => {
  it('produces a verified hash-chained audit bundle on a clean run', async () => {
    const records: ChainedRecord<EvidenceSpan>[] = []
    const agent = defineAgent({
      purpose: 'echo-bot',
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model: fakeModel([
        {
          content: '',
          toolCalls: [{ id: 't1', name: 'echo', args: { text: 'hello' } }],
          finishReason: 'tool_calls',
          tokensIn: 10,
          tokensOut: 5,
        },
        {
          content: '{"final":"hello"}',
          toolCalls: [],
          finishReason: 'stop',
          tokensIn: 12,
          tokensOut: 4,
        },
      ]),
      tools: [echoTool],
      output: z.object({ final: z.string() }),
      maxSteps: 5,
      retryBudget: 0,
      deps: {},
    })

    const policy = new StaticPolicyEngine([
      { id: 'allow.echo', toolName: 'echo', effect: 'allow' },
    ])

    const result = await runAgent(
      {
        definition: agent,
        policy,
        evidenceSink: (r) => records.push(r),
      },
      {
        tenant: makeTenantId('t-1'),
        principal: makePrincipalId('p-1'),
        secrets: inMemorySecrets({}),
        userMessage: 'say hello',
      },
    )

    expect(result.status).toBe('completed')
    expect(result.output).toEqual({ final: 'hello' })
    expect(verifyChain(records)).toBe(true)
    expect(records.some((r) => r.payload.span === 'agent.invoke')).toBe(true)
    expect(records.some((r) => r.payload.span === 'tool.execute')).toBe(true)
    expect(records.some((r) => r.payload.span === 'policy.evaluate')).toBe(true)
  })

  it('halts on policy deny without executing the tool', async () => {
    const records: ChainedRecord<EvidenceSpan>[] = []
    let toolRan = false
    const trapTool = defineTool.public({
      name: 'trap',
      description: 'should never run',
      input: z.object({}),
      output: z.object({}),
      threatBoundary: TB,
      retention: RET,
      run: async () => {
        toolRan = true
        return Ok({})
      },
    })
    const agent = defineAgent({
      purpose: 'deny-test',
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model: fakeModel([
        {
          content: '',
          toolCalls: [{ id: 't1', name: 'trap', args: {} }],
          finishReason: 'tool_calls',
          tokensIn: 1,
          tokensOut: 1,
        },
      ]),
      tools: [trapTool],
      output: z.object({}),
      maxSteps: 2,
      retryBudget: 0,
      deps: {},
    })
    const policy = new StaticPolicyEngine([
      { id: 'deny.trap', toolName: 'trap', effect: 'deny' },
    ])

    const result = await runAgent(
      {
        definition: agent,
        policy,
        evidenceSink: (r) => records.push(r),
      },
      {
        tenant: makeTenantId('t-1'),
        principal: makePrincipalId('p-1'),
        secrets: inMemorySecrets({}),
        userMessage: 'try',
      },
    )
    expect(result.status).toBe('policy-denied')
    expect(toolRan).toBe(false)
    expect(verifyChain(records)).toBe(true)
  })

  it('fail-stops on policy engine error', async () => {
    const records: ChainedRecord<EvidenceSpan>[] = []
    let toolRan = false
    const tool = defineTool.public({
      name: 'x',
      description: 't',
      input: z.object({}),
      output: z.object({}),
      threatBoundary: TB,
      retention: RET,
      run: async () => {
        toolRan = true
        return Ok({})
      },
    })
    const broken = {
      evaluate: async () => {
        throw new Error('cerbos exploded')
      },
    }
    const agent = defineAgent({
      purpose: 'engine-error-test',
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model: fakeModel([
        {
          content: '',
          toolCalls: [{ id: 't1', name: 'x', args: {} }],
          finishReason: 'tool_calls',
          tokensIn: 1,
          tokensOut: 1,
        },
      ]),
      tools: [tool],
      output: z.object({}),
      maxSteps: 2,
      retryBudget: 0,
      deps: {},
    })

    const result = await runAgent(
      { definition: agent, policy: broken, evidenceSink: (r) => records.push(r) },
      {
        tenant: makeTenantId('t-1'),
        principal: makePrincipalId('p-1'),
        secrets: inMemorySecrets({}),
        userMessage: 'try',
      },
    )
    expect(result.status).toBe('policy-denied')
    expect(toolRan).toBe(false)
    const policySpan = records.find((r) => r.payload.span === 'policy.evaluate')
    expect(policySpan?.payload.attrs['fuze.policy.engine_error']).toBe(true)
  })

  it('refuses runs when subjectRef is missing for personal-data tool', async () => {
    const personalTool = defineTool.personal({
      name: 'lookup',
      description: 'reads personal data',
      input: z.object({ id: z.string() }),
      output: z.object({ id: z.string() }),
      threatBoundary: TB,
      retention: RET,
      allowedLawfulBases: ['consent'],
      residencyRequired: 'eu',
      run: async (input) => Ok(input),
    })
    const agent = defineAgent({
      purpose: 'subjectref-test',
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model: fakeModel([]),
      tools: [personalTool],
      output: z.object({}),
      maxSteps: 1,
      retryBudget: 0,
      deps: {},
    })

    const result = await runAgent(
      {
        definition: agent,
        policy: new StaticPolicyEngine([{ id: 'a', toolName: '*', effect: 'allow' }]),
        evidenceSink: () => undefined,
      },
      {
        tenant: makeTenantId('t-1'),
        principal: makePrincipalId('p-1'),
        secrets: inMemorySecrets({}),
        userMessage: 'try',
      },
    )
    expect(result.status).toBe('error')
    expect(result.reason).toContain('subjectRef required')
  })

  it('refuses lawful basis incompatible with tool', async () => {
    const personalTool = defineTool.personal({
      name: 'lookup',
      description: 'reads personal data',
      input: z.object({}),
      output: z.object({}),
      threatBoundary: TB,
      retention: RET,
      allowedLawfulBases: ['consent'],
      residencyRequired: 'eu',
      run: async () => Ok({}),
    })
    const agent = defineAgent({
      purpose: 'lawful-basis-test',
      lawfulBasis: 'legitimate-interests',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model: fakeModel([]),
      tools: [personalTool],
      output: z.object({}),
      maxSteps: 1,
      retryBudget: 0,
      deps: {},
    })
    const result = await runAgent(
      {
        definition: agent,
        policy: new StaticPolicyEngine([{ id: 'a', toolName: '*', effect: 'allow' }]),
        evidenceSink: () => undefined,
      },
      {
        tenant: makeTenantId('t-1'),
        principal: makePrincipalId('p-1'),
        subjectRef: { hmac: 'h', scheme: 'hmac-sha256' },
        secrets: inMemorySecrets({}),
        userMessage: 'try',
      },
    )
    expect(result.status).toBe('error')
    expect(result.reason).toContain('lawful basis')
  })

  it('emits evidence with retention policy id and lawful basis on every span', async () => {
    const records: ChainedRecord<EvidenceSpan>[] = []
    const agent = defineAgent({
      purpose: 'attrs-test',
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model: fakeModel([
        { content: '{"final":"x"}', toolCalls: [], finishReason: 'stop', tokensIn: 1, tokensOut: 1 },
      ]),
      tools: [echoTool],
      output: z.object({ final: z.string() }),
      maxSteps: 2,
      retryBudget: 0,
      retention: { id: 'custom.v9', hashTtlDays: 1, fullContentTtlDays: 1, decisionTtlDays: 1 },
      deps: {},
    })
    await runAgent(
      {
        definition: agent,
        policy: new StaticPolicyEngine([{ id: 'a', toolName: '*', effect: 'allow' }]),
        evidenceSink: (r) => records.push(r),
      },
      {
        tenant: makeTenantId('t-9'),
        principal: makePrincipalId('p-9'),
        secrets: inMemorySecrets({}),
        userMessage: 'go',
      },
    )
    for (const r of records) {
      expect(r.payload.common['fuze.retention.policy_id']).toBe('custom.v9')
      expect(r.payload.common['fuze.lawful_basis']).toBe('consent')
      expect(r.payload.common['fuze.tenant.id']).toBe('t-9')
    }
  })
})
