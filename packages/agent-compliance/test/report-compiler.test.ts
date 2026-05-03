import { describe, expect, it } from 'vitest'
import { HashChain, type EvidenceSpan } from '@fuze-ai/agent'
import { friaTemplate, type FRIAInput } from '@fuze-ai/agent-fria'
import { compileReport } from '../src/index.js'

const baseSpan = (): EvidenceSpan => ({
  span: 'tool.execute',
  role: 'tool',
  runId: 'run-1',
  stepId: 'step-1',
  startedAt: '2026-05-01T10:00:00.000Z',
  endedAt: '2026-05-01T10:00:00.250Z',
  common: {
    'fuze.tenant.id': 'tenant-1',
    'fuze.principal.id': 'principal-1',
    'fuze.lawful_basis': 'contract',
    'fuze.annex_iii_domain': 'employment',
    'fuze.art22_decision': true,
    'fuze.retention.policy_id': 'retention.v1',
  },
  attrs: { 'gen_ai.tool.name': 'lookup', 'fuze.tool.outcome': 'value', 'fuze.data_classification': 'personal' },
})

const friaInput = (): FRIAInput => {
  const template = friaTemplate('employment_screening')
  return {
    systemDescription: { name: 'Hiring Copilot', purpose: 'Screen candidates.', intendedUsers: ['recruiter'], affectedPopulation: ['candidates'] },
    annexIIICategory: 'employment_screening',
    dataFlows: { input: [], output: [] },
    fundamentalRightsAssessment: template.fundamentalRightsAssessment ?? [],
    mitigations: template.mitigations ?? [],
    monitoringPlan: template.monitoringPlan ?? [],
    signOff: { name: 'Officer', role: 'DPO', date: new Date('2026-05-01T00:00:00.000Z') },
  }
}

describe('compileReport', () => {
  it('compiles Annex IV through the unified entry point', async () => {
    const chain = new HashChain<EvidenceSpan>()
    const report = await compileReport({
      kind: 'annex-iv',
      annexIV: {
        projectId: 'project-1',
        projectName: 'Hiring Copilot',
        organisation: { id: 'org-1', name: 'Fuze Test Ltd', address: 'Dublin' },
        declaredRoles: { deployer: true, provider: false, component_supplier: false },
        dateRange: { from: new Date('2026-05-01T00:00:00.000Z'), to: new Date('2026-05-02T00:00:00.000Z') },
        spans: [chain.append(baseSpan())],
        suspendedRuns: [],
        oversightDecisions: [],
        signedRunRoots: [],
      },
    })
    expect(report.kind).toBe('annex-iv')
    expect(report.pdf.length).toBeGreaterThan(1000)
    expect(report.contentHash).toHaveLength(64)
  })

  it('compiles FRIA and incident reports through the unified entry point', async () => {
    const fria = await compileReport({ kind: 'fria', fria: friaInput() })
    expect(fria.kind).toBe('fria')
    expect(fria.contentHash).toHaveLength(64)

    const incident = await compileReport({
      kind: 'incident',
      incident: {
        organisation: { id: 'org-1', name: 'Fuze Test Ltd', contact: 'compliance@example.test' },
        affectedSystems: [{ id: 'system-1', name: 'Hiring Copilot', deploymentDate: new Date('2026-01-01T00:00:00.000Z') }],
        incident: { detectedAt: new Date('2026-05-01T00:00:00.000Z'), summary: 'Serious harm event.', severity: 'serious_harm', affectedPersonsEstimate: 1 },
        rootCause: { description: 'Tool error.', categoryTags: ['tool'] },
        evidenceRefs: { runIds: ['run-1'], chainHeads: ['a'.repeat(64)] },
        mitigationsApplied: [],
        notifications: [],
      },
    })
    expect(incident.kind).toBe('incident')
    expect(incident.contentHash).toHaveLength(64)
  })
})
