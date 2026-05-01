import { z } from 'zod'
import {
  defineAgent,
  defineTool,
  Ok,
  type AgentDefinition,
  type FuzeModel,
  type ModelStep,
  type ThreatBoundary,
} from '@fuze-ai/agent'

const tb: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

export const echoTool = defineTool.public({
  name: 'echo',
  description: 'echoes input',
  input: z.object({ text: z.string() }),
  output: z.object({ echoed: z.string() }),
  threatBoundary: tb,
  retention: { id: 'eval.test.v1', hashTtlDays: 30, fullContentTtlDays: 7, decisionTtlDays: 30 },
  run: async (input) => Ok({ echoed: input.text }),
})

export const scriptedModel = (steps: readonly ModelStep[]): FuzeModel => {
  let i = 0
  return {
    providerName: 'fake',
    modelName: 'eval-test',
    residency: 'eu',
    generate: async () => {
      const s = steps[i++]
      if (!s) throw new Error('exhausted')
      return s
    },
  }
}

export const buildEchoAgent = (
  output: string,
): AgentDefinition<Record<string, never>, { echo: string }> =>
  defineAgent({
    purpose: 'eval-echo',
    lawfulBasis: 'consent',
    annexIIIDomain: 'none',
    producesArt22Decision: false,
    model: scriptedModel([
      {
        content: '',
        toolCalls: [{ id: 'c1', name: 'echo', args: { text: output } }],
        finishReason: 'tool_calls',
        tokensIn: 5,
        tokensOut: 3,
      },
      {
        content: JSON.stringify({ echo: output }),
        toolCalls: [],
        finishReason: 'stop',
        tokensIn: 5,
        tokensOut: 3,
      },
    ]),
    tools: [echoTool],
    output: z.object({ echo: z.string() }),
    maxSteps: 5,
    retryBudget: 0,
    deps: {},
  })
