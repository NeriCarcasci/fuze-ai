import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { generateDpia } from '@fuze-ai/agent-compliance'
import {
  generateAnnexIvReport,
  commissionAnnexIvMapping,
  iso42001Mapping,
} from '@fuze-ai/agent-annex-iv'
import type { EvidenceRecord } from '@fuze-ai/agent-annex-iv'

import { defineAgent } from '../../src/agent/define-agent.js'
import { defineTool } from '../../src/agent/define-tool.js'
import { inMemorySecrets } from '../../src/agent/secrets-noop.js'
import { runAgent } from '../../src/loop/loop.js'
import { StaticPolicyEngine } from '../../src/policy/static.js'
import type { ChainedRecord } from '../../src/evidence/hash-chain.js'
import type { EvidenceSpan } from '../../src/evidence/emitter.js'
import type { FuzeModel, ModelStep } from '../../src/types/model.js'
import type {
  ThreatBoundary,
  RetentionPolicy,
} from '../../src/types/compliance.js'
import { Ok } from '../../src/types/result.js'
import { makeTenantId, makePrincipalId } from '../../src/types/brand.js'
import type { AgentDefinition } from '../../src/types/agent.js'

const TB: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}
const RET: RetentionPolicy = {
  id: 'integration.dpia.v1',
  hashTtlDays: 30,
  fullContentTtlDays: 7,
  decisionTtlDays: 90,
}

const triageTool = defineTool.public({
  name: 'triage_application',
  description: 'triages an employment application (HITL-gated)',
  input: z.object({ applicantId: z.string() }),
  output: z.object({ decision: z.string() }),
  threatBoundary: TB,
  retention: RET,
  needsApproval: () => true,
  run: async (input) => Ok({ decision: `keep ${input.applicantId}` }),
})

const fakeModel = (steps: ModelStep[]): FuzeModel => {
  let i = 0
  return {
    providerName: 'fake',
    modelName: 'fake-employment-1',
    residency: 'eu',
    generate: async () => {
      const s = steps[i++]
      if (!s) throw new Error('fakeModel exhausted')
      return s
    },
  }
}

const makeEmploymentAgent = (): AgentDefinition<unknown, { final: string }> =>
  defineAgent({
    purpose: 'employment-triage',
    lawfulBasis: 'contract',
    annexIIIDomain: 'employment',
    producesArt22Decision: true,
    art14OversightPlan: {
      id: 'plan-employment-v1',
      trainingId: 'cert-2026-q1',
    },
    model: fakeModel([
      {
        content: '{"final":"complete"}',
        toolCalls: [],
        finishReason: 'stop',
        tokensIn: 5,
        tokensOut: 5,
      },
    ]),
    tools: [triageTool],
    output: z.object({ final: z.string() }),
    maxSteps: 3,
    retryBudget: 0,
    deps: {},
  })

describe('integration: DPIA + Annex IV generation', () => {
  it('DPIA flags Art. 22 risk + Annex III employment domain risk', () => {
    const agent = makeEmploymentAgent()
    const dpia = generateDpia(agent)

    expect(dpia.purpose).toBe('employment-triage')
    expect(dpia.lawfulBasis).toBe('contract')
    expect(dpia.annexIIIDomain).toBe('employment')
    expect(dpia.producesArt22Decision).toBe(true)

    const art22Risk = dpia.risks.find((r) => r.kind === 'automated-decision')
    expect(art22Risk).toBeDefined()
    expect(art22Risk?.description).toMatch(/Article 22/)

    const annexIIIRisk = dpia.risks.find((r) => r.kind === 'high-risk-domain')
    expect(annexIIIRisk).toBeDefined()
    expect(annexIIIRisk?.description).toMatch(/employment/)

    expect(dpia.oversightPlanRef?.id).toBe('plan-employment-v1')
    expect(dpia.oversightPlanRef?.trainingId).toBe('cert-2026-q1')
  })

  it('Annex IV report from real evidence records identifies Commission-mapped sections', async () => {
    const agent = makeEmploymentAgent()
    const records: ChainedRecord<EvidenceSpan>[] = []
    const result = await runAgent(
      {
        definition: agent,
        policy: new StaticPolicyEngine([
          { id: 'allow.triage', toolName: 'triage_application', effect: 'allow' },
        ]),
        evidenceSink: (r) => records.push(r),
      },
      {
        tenant: makeTenantId('t-employment'),
        principal: makePrincipalId('p-recruiter'),
        secrets: inMemorySecrets({}),
        userMessage: 'process this application',
      },
    )
    expect(result.status).toBe('completed')
    expect(records.length).toBeGreaterThan(0)

    const evidenceRecords: EvidenceRecord[] = records.map((r) => r)

    const report = generateAnnexIvReport({
      records: evidenceRecords,
      agentDefinition: agent,
      mapping: commissionAnnexIvMapping,
    })

    expect(report.totalSpans).toBe(records.length)
    expect(report.agent.annexIIIDomain).toBe('employment')
    expect(report.agent.producesArt22Decision).toBe(true)
    expect(report.agent.lawfulBasis).toBe('contract')

    const generalSection = report.findings.find(
      (f) => f.sectionId === '§1(a) general description',
    )
    expect(generalSection).toBeDefined()
    expect(generalSection?.matchedAttributes).toContain('fuze.tenant.id')
    expect(generalSection?.matchedAttributes).toContain('fuze.principal.id')

    const dataGov = report.findings.find((f) => f.sectionId === '§2(b) data governance')
    expect(dataGov).toBeDefined()
    expect(dataGov?.matchedAttributes).toContain('fuze.lawful_basis')

    const computeSection = report.findings.find(
      (f) => f.sectionId === '§3(b) computational resources',
    )
    expect(computeSection).toBeDefined()
    expect(computeSection?.matchedAttributes.length).toBeGreaterThan(0)
    expect(computeSection?.matchedAttributes).toContain('gen_ai.usage.input_tokens')
  })

  it('ISO 42001 mapping yields a different gap profile than the Commission mapping', async () => {
    const agent = makeEmploymentAgent()
    const records: ChainedRecord<EvidenceSpan>[] = []
    await runAgent(
      {
        definition: agent,
        policy: new StaticPolicyEngine([
          { id: 'allow.triage', toolName: 'triage_application', effect: 'allow' },
        ]),
        evidenceSink: (r) => records.push(r),
      },
      {
        tenant: makeTenantId('t-employment'),
        principal: makePrincipalId('p-recruiter'),
        secrets: inMemorySecrets({}),
        userMessage: 'process this application',
      },
    )

    const commissionReport = generateAnnexIvReport({
      records,
      agentDefinition: agent,
      mapping: commissionAnnexIvMapping,
    })
    const isoReport = generateAnnexIvReport({
      records,
      agentDefinition: agent,
      mapping: iso42001Mapping,
    })

    expect(commissionReport.mappingId).toBe(commissionAnnexIvMapping.id)
    expect(isoReport.mappingId).toBe(iso42001Mapping.id)
    expect(commissionReport.totalSpans).toBe(isoReport.totalSpans)

    expect(commissionReport.findings.length).toBe(commissionAnnexIvMapping.sections.length)
    expect(isoReport.findings.length).toBe(iso42001Mapping.sections.length)
  })
})
