import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  type ChainedRecord,
  type EvidenceSpan,
  type SubjectRef,
} from '@fuze-ai/agent'
import { LocalKeySigner } from '@fuze-ai/agent-signing'
import { piiGuardrail } from '@fuze-ai/agent-guardrails'

const personalBoundary: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

const publicBoundary: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

const retention = {
  id: 'support.v1',
  hashTtlDays: 60,
  fullContentTtlDays: 14,
  decisionTtlDays: 180,
}

const lookupCustomer = defineTool.personal({
  name: 'lookup_customer',
  description: 'Fetch the customer profile (account, plan, recent orders).',
  input: z.object({ customerId: z.string() }),
  output: z.object({
    customerId: z.string(),
    plan: z.string(),
    lastOrderAmountEur: z.number().nonnegative(),
  }),
  threatBoundary: personalBoundary,
  retention,
  residencyRequired: 'eu',
  allowedLawfulBases: ['contract'],
  run: async (input) =>
    Ok({ customerId: input.customerId, plan: 'standard', lastOrderAmountEur: 42.5 }),
})

const searchKnowledge = defineTool.public({
  name: 'search_knowledge',
  description: 'Search the public help-center knowledge base.',
  input: z.object({ query: z.string() }),
  output: z.object({ snippets: z.array(z.string()) }),
  threatBoundary: publicBoundary,
  retention,
  run: async (input) =>
    Ok({
      snippets: [
        `Article: how-to-${input.query.replace(/\s+/g, '-')}`,
        'Refund policy: full refunds within 14 days for digital goods.',
      ],
    }),
})

const escalate = defineTool.personal({
  name: 'escalate',
  description: 'Open a support ticket. Refunds over EUR 100 require human approval.',
  input: z.object({
    customerId: z.string(),
    reason: z.string(),
    refundAmountEur: z.number().nonnegative(),
  }),
  output: z.object({ ticketId: z.string() }),
  threatBoundary: personalBoundary,
  retention,
  residencyRequired: 'eu',
  allowedLawfulBases: ['contract'],
  needsApproval: (input) => input.refundAmountEur > 100,
  run: async (input) => Ok({ ticketId: `T-${input.customerId}-001` }),
})

const scriptedModel = (steps: readonly ModelStep[]): FuzeModel => {
  let i = 0
  return {
    providerName: 'fake',
    modelName: 'support-agent',
    residency: 'eu',
    generate: async () => {
      const s = steps[i++]
      if (!s) throw new Error('exhausted')
      return s
    },
  }
}

export interface SupportInput {
  readonly customerId: string
  readonly query: string
  readonly refundAmountEur: number
}

export const buildSupportAgent = (input: SupportInput) =>
  defineAgent({
    purpose: 'customer-support',
    lawfulBasis: 'contract',
    annexIIIDomain: 'none',
    producesArt22Decision: false,
    model: scriptedModel([
      {
        content: '',
        toolCalls: [
          { id: 'c1', name: 'lookup_customer', args: { customerId: input.customerId } },
        ],
        finishReason: 'tool_calls',
        tokensIn: 25,
        tokensOut: 10,
      },
      {
        content: '',
        toolCalls: [{ id: 'c2', name: 'search_knowledge', args: { query: input.query } }],
        finishReason: 'tool_calls',
        tokensIn: 25,
        tokensOut: 10,
      },
      {
        content: '',
        toolCalls: [
          {
            id: 'c3',
            name: 'escalate',
            args: {
              customerId: input.customerId,
              reason: input.query,
              refundAmountEur: input.refundAmountEur,
            },
          },
        ],
        finishReason: 'tool_calls',
        tokensIn: 25,
        tokensOut: 12,
      },
      {
        content: JSON.stringify({ ticketId: `T-${input.customerId}-001`, customerId: input.customerId }),
        toolCalls: [],
        finishReason: 'stop',
        tokensIn: 15,
        tokensOut: 10,
      },
    ]),
    tools: [lookupCustomer, searchKnowledge, escalate],
    guardrails: {
      input: [piiGuardrail({ kinds: ['creditCard', 'iban'] })],
      toolResult: [piiGuardrail({ phase: 'toolResult', kinds: ['creditCard'] })],
    },
    output: z.object({ ticketId: z.string(), customerId: z.string() }),
    maxSteps: 6,
    retryBudget: 0,
    deps: {},
  })

export const buildPolicy = () =>
  new StaticPolicyEngine([
    { id: 'allow.lookup', toolName: 'lookup_customer', effect: 'allow' },
    { id: 'allow.search', toolName: 'search_knowledge', effect: 'allow' },
    {
      id: 'approve.large-refund',
      toolName: 'escalate',
      effect: 'requires-approval',
      when: (i) => {
        const args = i.args as { refundAmountEur?: number }
        return typeof args.refundAmountEur === 'number' && args.refundAmountEur > 100
      },
    },
    { id: 'allow.escalate', toolName: 'escalate', effect: 'allow' },
  ])

export const buildSubjectRef = (customerId: string): SubjectRef => ({
  scheme: 'hmac-sha256',
  hmac: `hmac-${customerId}`,
})

const main = async (): Promise<void> => {
  const records: ChainedRecord<EvidenceSpan>[] = []
  const keyDir = mkdtempSync(join(tmpdir(), 'fuze-support-'))
  const signer = new LocalKeySigner({ keyPath: join(keyDir, 'agent-key') })
  const policy = buildPolicy()

  const agent = buildSupportAgent({
    customerId: 'c-9000',
    query: 'order status',
    refundAmountEur: 25,
  })

  const result = await runAgent(
    {
      definition: agent,
      policy,
      evidenceSink: (r) => {
        records.push(r)
      },
      signer,
    },
    {
      tenant: makeTenantId('support-prod'),
      principal: makePrincipalId('agent-runtime'),
      subjectRef: buildSubjectRef('c-9000'),
      secrets: inMemorySecrets({}),
      userMessage: 'help with order status',
    },
  )

  console.log(
    JSON.stringify(
      {
        status: result.status,
        output: result.output,
        steps: result.steps,
        hashChainValid: verifyChain(records),
        spanCount: records.length,
      },
      null,
      2,
    ),
  )
}

const isMain = (): boolean => {
  const arg = process.argv[1]
  if (!arg) return false
  return arg.endsWith('index.ts') || arg.endsWith('index.js')
}

if (isMain()) {
  await main()
}
