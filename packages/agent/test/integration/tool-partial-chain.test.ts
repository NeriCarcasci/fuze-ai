import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { defineAgent } from '../../src/agent/define-agent.js'
import { defineTool } from '../../src/agent/define-tool.js'
import { inMemorySecrets } from '../../src/agent/secrets-noop.js'
import { runAgent } from '../../src/loop/loop.js'
import { StaticPolicyEngine } from '../../src/policy/static.js'
import { verifyChain } from '../../src/evidence/hash-chain.js'
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
  id: 'integration.tool-partial.v1',
  hashTtlDays: 30,
  fullContentTtlDays: 7,
  decisionTtlDays: 90,
}

const streamingEcho = defineTool.public({
  name: 'streaming_echo',
  description: 'emits N partial spans then returns concatenated output',
  input: z.object({ chunks: z.array(z.string()) }),
  output: z.object({ joined: z.string(), count: z.number().int() }),
  threatBoundary: TB,
  retention: RET,
  run: async (input, ctx) => {
    const emit = ctx.emitChild
    let joined = ''
    for (let i = 0; i < input.chunks.length; i++) {
      const chunk = input.chunks[i] ?? ''
      joined += chunk
      if (emit) {
        emit({
          span: 'tool.partial',
          attrs: {
            'gen_ai.tool.name': 'streaming_echo',
            'fuze.partial.sequence_number': i,
            'fuze.partial.final_chunk': i === input.chunks.length - 1,
          },
          content: { chunk },
        })
      }
    }
    return Ok({ joined, count: input.chunks.length })
  },
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

describe('tool.partial spans chain into the run-root', () => {
  it('emits tool.start, three tool.partial spans, then tool.execute, all chaining and verifying', async () => {
    const captured: ChainedRecord<EvidenceSpan>[] = []
    const model = fakeModel([
      {
        content: '',
        toolCalls: [{ id: 'c1', name: 'streaming_echo', args: { chunks: ['a', 'b', 'c'] } }],
        finishReason: 'tool_calls',
        tokensIn: 1,
        tokensOut: 1,
      },
      {
        content: '{}',
        toolCalls: [],
        finishReason: 'stop',
        tokensIn: 1,
        tokensOut: 1,
      },
    ])

    const agent = defineAgent({
      purpose: 'tool-partial-test',
      lawfulBasis: 'consent',
      annexIIIDomain: 'none',
      producesArt22Decision: false,
      model,
      tools: [streamingEcho],
      output: z.object({}),
      maxSteps: 3,
      retryBudget: 0,
      deps: {},
    })

    const result = await runAgent(
      {
        definition: agent,
        policy: new StaticPolicyEngine([{ id: 'allow-all', toolName: '*', effect: 'allow' }]),
        evidenceSink: (record) => {
          captured.push(record)
        },
      },
      {
        tenant: makeTenantId('t-1'),
        principal: makePrincipalId('p-1'),
        userMessage: 'go',
        secrets: inMemorySecrets({}),
      },
    )

    expect(result.status).toBe('completed')
    expect(verifyChain(captured)).toBe(true)

    const partials = captured.filter((r) => r.payload.span === 'tool.partial')
    expect(partials.length).toBe(3)
    const seqs = partials.map((r) => r.payload.attrs['fuze.partial.sequence_number'])
    expect(seqs).toEqual([0, 1, 2])
    const finalFlags = partials.map((r) => r.payload.attrs['fuze.partial.final_chunk'])
    expect(finalFlags).toEqual([false, false, true])

    const toolExecuteIdx = captured.findIndex((r) => r.payload.span === 'tool.execute')
    const lastPartialIdx = captured.map((r, i) => ({ r, i })).filter((x) => x.r.payload.span === 'tool.partial').pop()?.i
    expect(lastPartialIdx).toBeDefined()
    expect(toolExecuteIdx).toBeGreaterThan(lastPartialIdx!)
  })
})
