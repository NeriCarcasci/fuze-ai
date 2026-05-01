import { z } from 'zod'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  defineAgent,
  defineTool,
  inMemorySecrets,
  runAgent,
  resumeRun,
  InMemoryNonceStore,
  verifyChain,
  makeTenantId,
  makePrincipalId,
  Ok,
  type FuzeModel,
  type ModelStep,
  type ThreatBoundary,
  type ChainedRecord,
  type EvidenceSpan,
} from '@fuze-ai/agent'
import { CerbosCompatPolicyEngine } from '@fuze-ai/agent-policy-cerbos'
import { LocalKeySigner, LocalKeyVerifier } from '@fuze-ai/agent-signing'

const threatBoundary: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

const transferFunds = defineTool.public({
  name: 'transfer_funds',
  description: 'transfers funds — high-risk operation requiring human approval',
  input: z.object({ amount: z.number(), to: z.string() }),
  output: z.object({ confirmation: z.string() }),
  threatBoundary,
  retention: { id: 'demo.v1', hashTtlDays: 30, fullContentTtlDays: 7, decisionTtlDays: 365 },
  needsApproval: () => true,
  run: async (input) => Ok({ confirmation: `transferred ${input.amount} to ${input.to}` }),
})

const scriptedModel = (steps: readonly ModelStep[]): FuzeModel => {
  let i = 0
  return {
    providerName: 'fake',
    modelName: 'demo',
    residency: 'eu',
    generate: async () => {
      const s = steps[i++]
      if (!s) throw new Error('exhausted')
      return s
    },
  }
}

const policyYaml = `
apiVersion: api.cerbos.dev/v1
resourcePolicy:
  resource: transfer_funds
  rules:
    - actions: ["invoke"]
      effect: EFFECT_REQUIRES_APPROVAL
`

const keyDir = mkdtempSync(join(tmpdir(), 'fuze-demo-'))
const signer = new LocalKeySigner({ keyPath: join(keyDir, 'agent-key') })
const verifier = LocalKeyVerifier.fromSigner(signer)

const agent = defineAgent({
  purpose: 'demo-bank-agent',
  lawfulBasis: 'contract',
  annexIIIDomain: 'none',
  producesArt22Decision: true,
  art14OversightPlan: { id: 'plan-001', trainingId: 'training-q4-2026' },
  model: scriptedModel([
    {
      content: '',
      toolCalls: [{ id: 'c1', name: 'transfer_funds', args: { amount: 5000, to: 'acc-42' } }],
      finishReason: 'tool_calls',
      tokensIn: 20,
      tokensOut: 10,
    },
  ]),
  tools: [transferFunds],
  output: z.object({ result: z.string() }),
  maxSteps: 5,
  retryBudget: 0,
  deps: {},
})

const records: ChainedRecord<EvidenceSpan>[] = []
const policy = new CerbosCompatPolicyEngine([policyYaml])

const result = await runAgent(
  { definition: agent, policy, evidenceSink: (r) => records.push(r), signer },
  {
    tenant: makeTenantId('bank-demo'),
    principal: makePrincipalId('user-007'),
    secrets: inMemorySecrets({}),
    userMessage: 'wire 5000 to account 42',
  },
)

console.log('=== Initial run ===')
console.log({
  status: result.status,
  reason: result.reason,
  steps: result.steps,
  hashChainValid: verifyChain(records),
  suspendedTool: result.suspended?.toolName,
  suspendedArgs: result.suspended?.toolArgs,
  resumeToken: result.suspended?.resumeToken
    ? {
        runId: result.suspended.resumeToken.runId,
        suspendedAtSequence: result.suspended.resumeToken.suspendedAtSequence,
        publicKeyId: result.suspended.resumeToken.publicKeyId,
        signatureLen: result.suspended.resumeToken.signature.length,
      }
    : null,
})

if (!result.suspended) {
  console.error('expected suspended run')
  process.exit(1)
}

const continuationAgent = defineAgent({
  purpose: 'demo-bank-agent',
  lawfulBasis: 'contract',
  annexIIIDomain: 'none',
  producesArt22Decision: true,
  art14OversightPlan: { id: 'plan-001', trainingId: 'training-q4-2026' },
  model: scriptedModel([
    {
      content: '{"result":"transfer complete"}',
      toolCalls: [],
      finishReason: 'stop',
      tokensIn: 10,
      tokensOut: 5,
    },
  ]),
  tools: [transferFunds],
  output: z.object({ result: z.string() }),
  maxSteps: 5,
  retryBudget: 0,
  deps: {},
})

const downstream: ChainedRecord<EvidenceSpan>[] = []
const nonceStore = new InMemoryNonceStore()

const continuation = await resumeRun(
  {
    definition: continuationAgent,
    policy,
    verifier,
    nonceStore,
    evidenceSink: (r) => downstream.push(r),
  },
  {
    suspended: result.suspended,
    decision: {
      action: 'approve',
      rationale: 'verified counterparty and amount within policy',
      overseerId: 'compliance-officer-jane',
      trainingId: 'training-q4-2026',
    },
    tenant: makeTenantId('bank-demo'),
    principal: makePrincipalId('user-007'),
    secrets: inMemorySecrets({}),
    priorHistory: [{ role: 'user', content: 'wire 5000 to account 42' }],
  },
)

console.log()
console.log('=== Resumed run ===')
console.log({
  status: continuation.status,
  output: continuation.output,
  steps: continuation.steps,
  finalChainHead: continuation.evidenceHashChainHead,
})

console.log()
console.log('=== Continuation evidence (chained from suspend point) ===')
for (const r of downstream) {
  console.log(
    JSON.stringify({ seq: r.sequence, span: r.payload.span, role: r.payload.role }, null, 2),
  )
}

console.log()
console.log('=== Replay attempt (should fail) ===')
const replay = await resumeRun(
  {
    definition: continuationAgent,
    policy,
    verifier,
    nonceStore,
    evidenceSink: () => undefined,
  },
  {
    suspended: result.suspended,
    decision: {
      action: 'approve',
      rationale: 'attempted replay',
      overseerId: 'attacker',
    },
    tenant: makeTenantId('bank-demo'),
    principal: makePrincipalId('user-007'),
    secrets: inMemorySecrets({}),
    priorHistory: [],
  },
).catch((e: Error) => ({ status: 'rejected-by-throw', error: e.name }))

console.log(replay)
