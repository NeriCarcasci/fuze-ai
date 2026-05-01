import { describe, expect, it } from 'vitest'
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
import { generateDpia } from '../src/dpia.js'

const TB: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

const RET: RetentionPolicy = DEFAULT_RETENTION

const stubModel: FuzeModel = {
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

const echoTool = defineTool.public({
  name: 'echo',
  description: 'echoes input',
  input: z.object({ x: z.string() }),
  output: z.object({ x: z.string() }),
  threatBoundary: TB,
  retention: RET,
  run: async (input) => Ok({ x: input.x }),
})

const personalTool = defineTool.personal({
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

const specialTool = defineTool.specialCategory({
  name: 'health-record',
  description: 'reads a health record',
  input: z.object({ id: z.string() }),
  output: z.object({ note: z.string() }),
  threatBoundary: TB,
  retention: RET,
  allowedLawfulBases: ['consent'],
  art9Basis: 'explicit-consent',
  run: async () => Ok({ note: '' }),
})

const nonEuTool = defineTool.business({
  name: 'us-crm-lookup',
  description: 'queries a US-hosted CRM',
  input: z.object({ id: z.string() }),
  output: z.object({ name: z.string() }),
  threatBoundary: TB,
  retention: RET,
  residencyRequired: 'any',
  allowedLawfulBases: ['legitimate-interests'],
  run: async () => Ok({ name: '' }),
})

const buildAgent = (
  overrides: {
    tools?: readonly AnyFuzeTool[]
    annexIIIDomain?: AgentDefinition<unknown, unknown>['annexIIIDomain']
    producesArt22Decision?: boolean
  } = {},
): AgentDefinition<unknown, unknown> =>
  defineAgent<unknown, { ok: boolean }>({
    purpose: 'unit-test agent',
    lawfulBasis: 'contract',
    annexIIIDomain: overrides.annexIIIDomain ?? 'none',
    producesArt22Decision: overrides.producesArt22Decision ?? false,
    model: stubModel,
    tools: overrides.tools ?? [echoTool],
    guardrails: emptyGuardrails<unknown>(),
    output: z.object({ ok: z.boolean() }),
    maxSteps: 4,
    retryBudget: 0,
    retention: RET,
    deps: undefined,
  })

describe('generateDpia', () => {
  it('generates a DPIA for a simple agent with one public tool', () => {
    const dpia = generateDpia(buildAgent())
    expect(dpia.version).toBe('1')
    expect(dpia.purpose).toBe('unit-test agent')
    expect(dpia.tools).toHaveLength(1)
    expect(dpia.tools[0]?.name).toBe('echo')
    expect(dpia.subProcessors).toEqual([])
  })

  it('includes the lawful basis from the definition', () => {
    const dpia = generateDpia(buildAgent())
    expect(dpia.lawfulBasis).toBe('contract')
  })

  it('flags special-category tools as a risk', () => {
    const dpia = generateDpia(buildAgent({ tools: [echoTool, specialTool] }))
    const risk = dpia.risks.find((r) => r.kind === 'special-category-data')
    expect(risk).toBeDefined()
    expect(risk?.toolNames).toContain('health-record')
  })

  it('flags producesArt22Decision as a risk', () => {
    const dpia = generateDpia(buildAgent({ producesArt22Decision: true }))
    expect(dpia.producesArt22Decision).toBe(true)
    expect(dpia.risks.some((r) => r.kind === 'automated-decision')).toBe(true)
  })

  it('flags annexIIIDomain != "none" as a high-risk-domain risk', () => {
    const dpia = generateDpia(buildAgent({ annexIIIDomain: 'employment' }))
    const risk = dpia.risks.find((r) => r.kind === 'high-risk-domain')
    expect(risk).toBeDefined()
    expect(risk?.description).toContain('employment')
  })

  it('flags non-EU residency tools as a cross-border-transfer risk', () => {
    const dpia = generateDpia(buildAgent({ tools: [personalTool, nonEuTool] }))
    const risk = dpia.risks.find((r) => r.kind === 'cross-border-transfer')
    expect(risk).toBeDefined()
    expect(risk?.toolNames).toEqual(['us-crm-lookup'])
    expect(dpia.residencySummary.euOnlyToolCount).toBe(1)
    expect(dpia.residencySummary.anyResidencyToolCount).toBe(1)
  })

  it('produces no risks for a clean agent with public tool only', () => {
    const dpia = generateDpia(buildAgent())
    expect(dpia.risks).toEqual([])
  })
})
