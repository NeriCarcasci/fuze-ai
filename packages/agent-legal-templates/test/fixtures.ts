import { z } from 'zod'
import {
  DEFAULT_RETENTION,
  defineAgent,
  defineTool,
  emptyGuardrails,
  Ok,
} from '@fuze-ai/agent'
import type {
  AgentDefinition,
  AnyFuzeTool,
  FuzeModel,
  RetentionPolicy,
  ThreatBoundary,
} from '@fuze-ai/agent'
import type { PartyRef } from '../src/types.js'

export const TB: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

export const RET: RetentionPolicy = DEFAULT_RETENTION

export const stubModel: FuzeModel = {
  providerName: 'stub',
  modelName: 'stub-1',
  residency: 'eu',
  generate: async () => ({
    content: '',
    toolCalls: [],
    finishReason: 'stop',
    tokensIn: 0,
    tokensOut: 0,
  }),
}

export const echoTool = defineTool.public({
  name: 'echo',
  description: 'echoes input',
  input: z.object({ x: z.string() }),
  output: z.object({ x: z.string() }),
  threatBoundary: TB,
  retention: RET,
  run: async (input) => Ok({ x: input.x }),
})

export const personalTool = defineTool.personal({
  name: 'lookup-customer',
  description: 'looks up a customer by id',
  input: z.object({ id: z.string() }),
  output: z.object({ name: z.string() }),
  threatBoundary: TB,
  retention: RET,
  residencyRequired: 'eu',
  allowedLawfulBases: ['contract'],
  run: async () => Ok({ name: 'Anon' }),
})

export const buildAgent = (tools: readonly AnyFuzeTool[] = [echoTool, personalTool]):
  AgentDefinition<unknown, unknown> =>
  defineAgent<unknown, { ok: boolean }>({
    purpose: 'process customer support requests',
    lawfulBasis: 'contract',
    annexIIIDomain: 'none',
    producesArt22Decision: false,
    model: stubModel,
    tools,
    guardrails: emptyGuardrails<unknown>(),
    output: z.object({ ok: z.boolean() }),
    maxSteps: 4,
    retryBudget: 0,
    retention: RET,
    deps: undefined,
  })

export const controllerParty: PartyRef = {
  legalName: 'Acme GmbH',
  address: 'Beispielstr. 1, 10115 Berlin',
  country: 'DE',
  contactEmail: 'dpo@acme.example',
}

export const processorParty: PartyRef = {
  legalName: 'Fuze Operator B.V.',
  address: 'Kade 5, 1011 AA Amsterdam',
  country: 'NL',
  contactEmail: 'legal@fuze.example',
}
