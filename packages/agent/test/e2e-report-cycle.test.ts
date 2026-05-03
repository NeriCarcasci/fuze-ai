import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineAgent, defineTool, inMemorySecrets, runAgent, resumeRun, InMemoryNonceStore, StaticPolicyEngine } from '../src/index.js'
import { Ok } from '../src/types/result.js'
import { makePrincipalId, makeTenantId } from '../src/types/brand.js'
import type { ChainedRecord, EvidenceSpan, FuzeModel, ModelStep, SignedRunRoot } from '../src/index.js'
import { LocalKeySigner, LocalKeyVerifier } from '@fuze-ai/agent-signing'
import { compileReport } from '@fuze-ai/agent-compliance'
import { friaTemplate, type FRIAInput } from '@fuze-ai/agent-fria'
import { deadlineFor } from '@fuze-ai/agent-incident'
import { synthesize } from '@fuze-ai/agent-synthesis'

const threatBoundary = {
  trustedCallers: ['agent-loop'] as const,
  observesSecrets: false,
  egressDomains: 'none' as const,
  readsFilesystem: false,
  writesFilesystem: false,
}

const retention = {
  id: 'phase7.retention.v1',
  hashTtlDays: 180,
  fullContentTtlDays: 30,
  decisionTtlDays: 365,
}

const fakeModel = (steps: readonly ModelStep[]): FuzeModel => {
  let index = 0
  return {
    providerName: 'mock',
    modelName: 'mock-report-cycle',
    residency: 'eu',
    generate: async () => {
      const step = steps[index]
      index++
      if (!step) throw new Error('mock model exhausted')
      return step
    },
  }
}

const publicTool = defineTool.public({
  name: 'profile-normalize',
  description: 'Normalizes public profile fields.',
  input: z.object({ text: z.string() }),
  output: z.object({ normalized: z.string() }),
  threatBoundary,
  retention,
  run: async (input) => Ok({ normalized: input.text.toLowerCase() }),
})

const personalTool = defineTool.personal({
  name: 'candidate-record',
  description: 'Fetches candidate personal record.',
  input: z.object({ candidateId: z.string() }),
  output: z.object({ status: z.string() }),
  threatBoundary,
  retention,
  residencyRequired: 'eu',
  allowedLawfulBases: ['contract'],
  needsApproval: () => true,
  run: async () => Ok({ status: 'eligible-for-review' }),
})

const signatureFor = async (signer: LocalKeySigner, runId: string, chainHead: string): Promise<SignedRunRoot> => ({
  runId,
  chainHead,
  nonce: 'root-nonce-1',
  signature: Buffer.from(await signer.sign(Buffer.from(chainHead, 'utf8'))).toString('base64'),
  publicKeyId: signer.publicKeyId,
  algorithm: 'ed25519',
})

const friaInput = (): FRIAInput => {
  const template = friaTemplate('employment_screening')
  return {
    systemDescription: {
      name: 'Hiring Copilot',
      purpose: 'Assist recruiters with candidate record review.',
      intendedUsers: ['recruiter', 'compliance officer'],
      affectedPopulation: ['job candidates'],
    },
    annexIIICategory: 'employment_screening',
    dataFlows: {
      input: [{ name: 'candidate profile', description: 'Candidate profile and application record.', dataClassification: 'personal', sourceOrRecipient: 'ATS', lawfulBasis: 'contract', retentionPolicy: retention.id }],
      output: [{ name: 'review status', description: 'Review status for human recruiter.', dataClassification: 'personal', sourceOrRecipient: 'Recruiter console', retentionPolicy: retention.id }],
    },
    fundamentalRightsAssessment: template.fundamentalRightsAssessment ?? [],
    mitigations: template.mitigations ?? [],
    monitoringPlan: template.monitoringPlan ?? [],
    signOff: { name: 'Compliance Officer', role: 'DPO', date: new Date('2026-05-01T12:00:00.000Z') },
  }
}

describe('phase 7 report cycle', () => {
  it('runs HITL suspend/resume and compiles Annex IV, FRIA, incident, and synthesis outputs', async () => {
    const records: ChainedRecord<EvidenceSpan>[] = []
    const signer = new LocalKeySigner({ keyPath: join(mkdtempSync(join(tmpdir(), 'fuze-phase7-')), 'agent-key') })
    const verifier = LocalKeyVerifier.fromSigner(signer)
    const model = fakeModel([
      {
        content: '',
        toolCalls: [
          { id: 'call-1', name: 'profile-normalize', args: { text: 'Candidate A' } },
          { id: 'call-2', name: 'candidate-record', args: { candidateId: 'cand-1' } },
        ],
        finishReason: 'tool_calls',
        tokensIn: 40,
        tokensOut: 20,
      },
      {
        content: '{"ok":true}',
        toolCalls: [],
        finishReason: 'stop',
        tokensIn: 30,
        tokensOut: 10,
      },
    ])
    const agent = defineAgent({
      purpose: 'Hiring Copilot',
      lawfulBasis: 'contract',
      annexIIIDomain: 'employment',
      producesArt22Decision: true,
      art14OversightPlan: { id: 'oversight.v1', trainingId: 'training-2026' },
      model,
      tools: [publicTool, personalTool],
      output: z.object({ ok: z.boolean() }),
      maxSteps: 4,
      retryBudget: 0,
      retention,
      deps: {},
    })
    const policy = new StaticPolicyEngine([
      { id: 'hitl.candidate-record', toolName: 'candidate-record', effect: 'requires-approval' },
      { id: 'allow.all', toolName: '*', effect: 'allow' },
    ])
    const tenant = makeTenantId('tenant-1')
    const principal = makePrincipalId('principal-1')
    const subjectRef = { hmac: 'subject-hmac-1', scheme: 'hmac-sha256' as const }

    const first = await runAgent(
      { definition: agent, policy, evidenceSink: (record) => records.push(record), signer },
      { tenant, principal, subjectRef, secrets: inMemorySecrets({}), userMessage: 'screen candidate cand-1' },
    )
    expect(first.status).toBe('suspended')
    expect(first.suspended?.toolName).toBe('candidate-record')

    const decision = {
      action: 'approve' as const,
      rationale: 'Candidate record access is necessary and proportionate for this screening run.',
      overseerId: 'overseer-1',
      trainingId: 'training-2026',
    }
    const resumed = await resumeRun(
      { definition: agent, policy, verifier, nonceStore: new InMemoryNonceStore(), evidenceSink: (record) => records.push(record) },
      {
        suspended: first.suspended!,
        decision,
        tenant,
        principal,
        subjectRef,
        secrets: inMemorySecrets({}),
        priorHistory: [],
      },
    )
    expect(resumed.status).toBe('completed')

    const signedRunRoot = await signatureFor(signer, resumed.runId, resumed.evidenceHashChainHead)
    const annex = await compileReport({
      kind: 'annex-iv',
      annexIV: {
        projectId: 'project-hiring',
        projectName: 'Hiring Copilot',
        organisation: { id: 'org-1', name: 'Fuze Test Ltd', address: '1 Test Street, Dublin' },
        declaredRoles: { deployer: true, provider: true, component_supplier: false },
        dateRange: { from: new Date('2026-05-01T00:00:00.000Z'), to: new Date('2026-05-02T00:00:00.000Z') },
        spans: records,
        suspendedRuns: first.suspended ? [first.suspended] : [],
        oversightDecisions: [{
          runId: resumed.runId,
          action: 'approve',
          rationale: decision.rationale,
          requestedAt: new Date('2026-05-01T10:00:00.000Z'),
          decidedAt: new Date('2026-05-01T10:03:00.000Z'),
          overseerId: decision.overseerId,
        }],
        evalResults: [{ id: 'eval-hiring', successRate: 0.95, coverage: 0.9, lastRunAt: new Date('2026-05-01T09:00:00.000Z') }],
        incidents: [],
        alertDeliveries: [{ id: 'alert-1', channel: 'email', deliveredAt: new Date('2026-05-01T10:04:00.000Z'), status: 'delivered' }],
        signedRunRoots: [signedRunRoot],
      },
    })
    expect(annex.pdf.length).toBeGreaterThan(1000)
    expect(annex.kind).toBe('annex-iv')
    expect('sections' in annex.json ? annex.json.sections : []).toHaveLength(8)

    const fria = await compileReport({ kind: 'fria', fria: friaInput() })
    expect(fria.kind).toBe('fria')
    expect('fundamentalRightsAssessment' in fria.json ? fria.json.fundamentalRightsAssessment : []).toHaveLength(7)

    const incident = await compileReport({
      kind: 'incident',
      incident: {
        organisation: { id: 'org-1', name: 'Fuze Test Ltd', contact: 'compliance@example.test' },
        affectedSystems: [{ id: 'project-hiring', name: 'Hiring Copilot', deploymentDate: new Date('2026-04-01T00:00:00.000Z') }],
        incident: { detectedAt: new Date('2026-05-01T12:00:00.000Z'), summary: 'Rights-impacting explanation defect.', severity: 'serious_harm', affectedPersonsEstimate: 1 },
        rootCause: { description: 'Incorrect explanation template selected during a tool continuation.', categoryTags: ['explanation', 'tool'] },
        evidenceRefs: { runIds: [resumed.runId], chainHeads: [resumed.evidenceHashChainHead], suspendedRunIds: [first.runId] },
        mitigationsApplied: [{ description: 'Paused affected workflow and enabled manual review.', appliedAt: new Date('2026-05-01T12:30:00.000Z') }],
        notifications: [{ authority: 'Irish competent authority' }],
      },
    })
    expect(incident.kind).toBe('incident')
    expect('deadline' in incident.json ? incident.json.deadline.hours : 0).toBe(deadlineFor('serious_harm').hours)

    const insights = synthesize({ runs: [records] })
    expect(insights.toolCallGraph.nodes.map((n) => n.toolName)).toEqual(
      expect.arrayContaining(['profile-normalize', 'candidate-record']),
    )
  }, 60_000)
})
