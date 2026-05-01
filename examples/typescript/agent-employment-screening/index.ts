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

const personalBoundary: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

const retention = {
  id: 'employment.screening.v1',
  hashTtlDays: 90,
  fullContentTtlDays: 30,
  decisionTtlDays: 365,
}

const lookupCandidate = defineTool.personal({
  name: 'lookup_candidate',
  description: 'Fetch the candidate dossier (CV, application, prior screenings).',
  input: z.object({ candidateId: z.string() }),
  output: z.object({
    candidateId: z.string(),
    role: z.string(),
    yearsExperience: z.number().int().nonnegative(),
    citizenship: z.string(),
  }),
  threatBoundary: personalBoundary,
  retention,
  residencyRequired: 'eu',
  allowedLawfulBases: ['legitimate-interests', 'contract'],
  run: async (input) =>
    Ok({
      candidateId: input.candidateId,
      role: 'senior-engineer',
      yearsExperience: 7,
      citizenship: 'PT',
    }),
})

const summarizeApplication = defineTool.personal({
  name: 'summarize_application',
  description: 'Produce a short structured summary of the candidate dossier.',
  input: z.object({ candidateId: z.string(), role: z.string() }),
  output: z.object({ summary: z.string(), strengths: z.array(z.string()) }),
  threatBoundary: personalBoundary,
  retention,
  residencyRequired: 'eu',
  allowedLawfulBases: ['legitimate-interests', 'contract'],
  run: async (input) =>
    Ok({
      summary: `Candidate ${input.candidateId} applied for ${input.role}.`,
      strengths: ['domain expertise', 'leadership signal'],
    }),
})

const recordRecommendation = defineTool.personal({
  name: 'record_recommendation',
  description: 'Persist the final recommendation. Always requires human approval (Art. 22).',
  input: z.object({
    candidateId: z.string(),
    decision: z.enum(['advance', 'reject', 'hold']),
    rationale: z.string(),
  }),
  output: z.object({ recordedAt: z.string() }),
  threatBoundary: personalBoundary,
  retention,
  residencyRequired: 'eu',
  allowedLawfulBases: ['legitimate-interests', 'contract'],
  needsApproval: () => true,
  run: async () => Ok({ recordedAt: new Date('2026-01-01T00:00:00.000Z').toISOString() }),
})

const scriptedModel = (steps: readonly ModelStep[]): FuzeModel => {
  let i = 0
  return {
    providerName: 'fake',
    modelName: 'employment-screener',
    residency: 'eu',
    generate: async () => {
      const s = steps[i++]
      if (!s) throw new Error('exhausted')
      return s
    },
  }
}

export const buildScreeningAgent = (candidateId: string) =>
  defineAgent({
    purpose: 'employment-screening',
    lawfulBasis: 'legitimate-interests',
    annexIIIDomain: 'employment',
    producesArt22Decision: true,
    art14OversightPlan: { id: 'oversight.hr.v1', trainingId: 'hr-training-2026' },
    model: scriptedModel([
      {
        content: '',
        toolCalls: [{ id: 'c1', name: 'lookup_candidate', args: { candidateId } }],
        finishReason: 'tool_calls',
        tokensIn: 30,
        tokensOut: 10,
      },
      {
        content: '',
        toolCalls: [
          { id: 'c2', name: 'summarize_application', args: { candidateId, role: 'senior-engineer' } },
        ],
        finishReason: 'tool_calls',
        tokensIn: 30,
        tokensOut: 12,
      },
      {
        content: '',
        toolCalls: [
          {
            id: 'c3',
            name: 'record_recommendation',
            args: { candidateId, decision: 'advance', rationale: 'qualifications align with role' },
          },
        ],
        finishReason: 'tool_calls',
        tokensIn: 25,
        tokensOut: 15,
      },
    ]),
    tools: [lookupCandidate, summarizeApplication, recordRecommendation],
    output: z.object({ candidateId: z.string(), decision: z.string() }),
    maxSteps: 6,
    retryBudget: 0,
    deps: {},
  })

export const buildPolicy = () =>
  new StaticPolicyEngine([
    { id: 'allow.lookup', toolName: 'lookup_candidate', effect: 'allow' },
    { id: 'allow.summarize', toolName: 'summarize_application', effect: 'allow' },
    { id: 'approve.record', toolName: 'record_recommendation', effect: 'requires-approval' },
  ])

export const buildSubjectRef = (candidateId: string): SubjectRef => ({
  scheme: 'hmac-sha256',
  hmac: `hmac-${candidateId}`,
})

const main = async (): Promise<void> => {
  const candidateId = 'cand-7421'
  const records: ChainedRecord<EvidenceSpan>[] = []
  const keyDir = mkdtempSync(join(tmpdir(), 'fuze-screen-'))
  const signer = new LocalKeySigner({ keyPath: join(keyDir, 'agent-key') })

  const agent = buildScreeningAgent(candidateId)
  const policy = buildPolicy()

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
      tenant: makeTenantId('hr-prod'),
      principal: makePrincipalId('recruiter-jane'),
      subjectRef: buildSubjectRef(candidateId),
      secrets: inMemorySecrets({}),
      userMessage: `screen candidate ${candidateId}`,
    },
  )

  console.log(
    JSON.stringify(
      {
        status: result.status,
        reason: result.reason,
        suspendedTool: result.suspended?.toolName,
        suspendedArgs: result.suspended?.toolArgs,
        steps: result.steps,
        hashChainValid: verifyChain(records),
        spanCount: records.length,
        spans: records.map((r) => ({ seq: r.sequence, span: r.payload.span })),
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
