import { z } from 'zod'
import {
  defineAgent,
  defineTool,
  inMemorySecrets,
  runAgent,
  StaticPolicyEngine,
  verifyChain,
  makeTenantId,
  makePrincipalId,
  Ok,
  type FuzeModel,
  type ModelStep,
  type ThreatBoundary,
} from '@fuze-ai/agent'

const threatBoundary: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

const greet = defineTool.public({
  name: 'greet',
  description: 'returns a greeting for the given name',
  input: z.object({ name: z.string() }),
  output: z.object({ greeting: z.string() }),
  threatBoundary,
  retention: { id: 'demo.v1', hashTtlDays: 30, fullContentTtlDays: 7, decisionTtlDays: 90 },
  run: async (input) => Ok({ greeting: `hello, ${input.name}` }),
})

const scriptedModel = (steps: readonly ModelStep[]): FuzeModel => {
  let i = 0
  return {
    providerName: 'fake',
    modelName: 'demo-1',
    residency: 'eu',
    generate: async () => {
      const s = steps[i++]
      if (!s) throw new Error('model exhausted')
      return s
    },
  }
}

const agent = defineAgent({
  purpose: 'demo-greeter',
  lawfulBasis: 'consent',
  annexIIIDomain: 'none',
  producesArt22Decision: false,
  model: scriptedModel([
    {
      content: '',
      toolCalls: [{ id: 'c1', name: 'greet', args: { name: 'world' } }],
      finishReason: 'tool_calls',
      tokensIn: 10,
      tokensOut: 5,
    },
    {
      content: '{"final":"hello, world"}',
      toolCalls: [],
      finishReason: 'stop',
      tokensIn: 12,
      tokensOut: 4,
    },
  ]),
  tools: [greet],
  output: z.object({ final: z.string() }),
  maxSteps: 5,
  retryBudget: 0,
  deps: {},
})

const records: Parameters<Parameters<typeof runAgent>[0]['evidenceSink']>[0][] = []
const policy = new StaticPolicyEngine([{ id: 'allow.greet', toolName: 'greet', effect: 'allow' }])

const result = await runAgent(
  { definition: agent, policy, evidenceSink: (r) => records.push(r) },
  {
    tenant: makeTenantId('demo-tenant'),
    principal: makePrincipalId('demo-user'),
    secrets: inMemorySecrets({}),
    userMessage: 'please greet world',
  },
)

console.log(JSON.stringify({
  status: result.status,
  output: result.output,
  steps: result.steps,
  hashChainHead: result.evidenceHashChainHead,
  hashChainValid: verifyChain(records),
  spans: records.map((r) => ({ seq: r.sequence, span: r.payload.span, role: r.payload.role })),
}, null, 2))
