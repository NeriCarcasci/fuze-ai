import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineAgent } from '../../src/agent/define-agent.js'
import { defineTool } from '../../src/agent/define-tool.js'
import { inMemorySecrets } from '../../src/agent/secrets-noop.js'
import { runAgent } from '../../src/loop/loop.js'
import { StaticPolicyEngine } from '../../src/policy/static.js'
import type { ChainedRecord } from '../../src/evidence/hash-chain.js'
import type { EvidenceSpan } from '../../src/evidence/emitter.js'
import type { FuzeModel, ModelStep } from '../../src/types/model.js'
import type { ThreatBoundary, RetentionPolicy } from '../../src/types/compliance.js'
import { Ok } from '../../src/types/result.js'
import { makeTenantId, makePrincipalId } from '../../src/types/brand.js'

const TB: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

const RET: RetentionPolicy = {
  id: 'bypass.v1',
  hashTtlDays: 30,
  fullContentTtlDays: 7,
  decisionTtlDays: 90,
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

describe('bypass: secret in args', () => {
  it('redacts OpenAI-style API key embedded in tool args', async () => {
    const records: ChainedRecord<EvidenceSpan>[] = []
    const fetcher = defineTool.public({
      name: 'http',
      description: 'http call',
      input: z.object({ authorization: z.string() }),
      output: z.object({ ok: z.boolean() }),
      threatBoundary: TB,
      retention: RET,
      run: async () => Ok({ ok: true }),
    })

    const leaked = `Bearer sk-${'A'.repeat(40)}`

    const agent = defineAgent({
      purpose: 'secret-leak-test',
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model: fakeModel([
        {
          content: '',
          toolCalls: [{ id: 'c1', name: 'http', args: { authorization: leaked } }],
          finishReason: 'tool_calls',
          tokensIn: 1,
          tokensOut: 1,
        },
        { content: '{"final":"x"}', toolCalls: [], finishReason: 'stop', tokensIn: 1, tokensOut: 1 },
      ]),
      tools: [fetcher],
      output: z.object({ final: z.string() }),
      maxSteps: 5,
      retryBudget: 0,
      deps: {},
    })

    await runAgent(
      {
        definition: agent,
        policy: new StaticPolicyEngine([{ id: 'a', toolName: '*', effect: 'allow' }]),
        evidenceSink: (r) => records.push(r),
        captureFullContent: true,
      },
      {
        tenant: makeTenantId('t-1'),
        principal: makePrincipalId('p-1'),
        secrets: inMemorySecrets({}),
        userMessage: 'fetch',
      },
    )

    const everySpanText = JSON.stringify(records)
    expect(everySpanText).not.toContain('sk-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
    expect(everySpanText).toContain('<<fuze:secret:redacted>>')
  })
})
