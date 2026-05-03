import { describe, expect, it } from 'vitest'
import { HashChain, type EvidenceSpan, type SignedRunRoot, type SuspendedRun } from '@fuze-ai/agent'
import { compileAnnexIV, type AnnexIVInput, type OversightDecisionRecord } from '../src/index.js'

const span = (
  name: string,
  role: EvidenceSpan['role'],
  attrs: Readonly<Record<string, unknown>>,
  startedAt = '2026-04-01T10:00:00.000Z',
  endedAt = '2026-04-01T10:00:01.000Z',
): EvidenceSpan => ({
  span: name,
  role,
  runId: 'run-1',
  stepId: `${name}-step`,
  startedAt,
  endedAt,
  common: {
    'fuze.tenant.id': 'tenant-1',
    'fuze.principal.id': 'principal-1',
    'fuze.lawful_basis': 'contract',
    'fuze.annex_iii_domain': 'employment',
    'fuze.art22_decision': true,
    'fuze.retention.policy_id': 'retention.v1',
  },
  attrs,
})

const fixture = (): AnnexIVInput => {
  const chain = new HashChain<EvidenceSpan>()
  const suspended: SuspendedRun = {
    runId: 'run-1',
    suspendedAtSpanId: 'suspend-step',
    suspendedAtSequence: 4,
    chainHeadAtSuspend: 'a'.repeat(64),
    toolName: 'candidate-lookup',
    toolArgs: { candidateId: 'c-1' },
    reason: 'approval required',
    definitionFingerprint: 'def-1',
    resumeToken: {
      runId: 'run-1',
      suspendedAtSequence: 4,
      chainHeadAtSuspend: 'a'.repeat(64),
      nonce: 'nonce-1',
      signature: 'b'.repeat(128),
      publicKeyId: 'key-1',
    },
  }
  const oversight: OversightDecisionRecord = {
    runId: 'run-1',
    action: 'approve',
    rationale: 'Reviewed candidate data use.',
    requestedAt: new Date('2026-04-01T10:00:00.000Z'),
    decidedAt: new Date('2026-04-01T10:04:00.000Z'),
    overseerId: 'officer-1',
  }
  const signed: SignedRunRoot = {
    runId: 'run-1',
    chainHead: 'c'.repeat(64),
    nonce: 'nonce-root',
    signature: 'd'.repeat(128),
    publicKeyId: 'key-1',
    algorithm: 'ed25519',
  }
  return {
    projectId: 'project-1',
    projectName: 'Hiring Copilot',
    organisation: { id: 'org-1', name: 'Fuze Test Ltd', address: '1 Test Street, Dublin' },
    declaredRoles: { deployer: true, provider: true, component_supplier: false },
    dateRange: { from: new Date('2026-04-01T00:00:00.000Z'), to: new Date('2026-04-30T23:59:59.000Z') },
    spans: [
      chain.append(span('agent.invoke', 'agent', { 'gen_ai.agent.name': 'employment screening assistant' })),
      chain.append(span('model.generate', 'model', { 'gen_ai.usage.input_tokens': 100, 'gen_ai.usage.output_tokens': 40, 'fuze.model.residency': 'eu' })),
      chain.append(span('policy.evaluate', 'policy', { 'fuze.policy.tool': 'candidate-lookup', 'fuze.policy.effect': 'requires-approval' })),
      chain.append(span('tool.execute', 'tool', { 'gen_ai.tool.name': 'candidate-lookup', 'fuze.data_classification': 'personal', 'fuze.tool.outcome': 'value' })),
      chain.append(span('guardrail.toolResult', 'guardrail', { 'fuze.guardrail.tripped': true, 'fuze.guardrail.failures': ['bias-check'] })),
      chain.append(span('tool.execute', 'tool', { 'gen_ai.tool.name': 'score-normalizer', 'fuze.data_classification': 'public', 'fuze.tool.outcome': 'error' })),
    ],
    suspendedRuns: [suspended],
    oversightDecisions: [oversight],
    evalResults: [{ id: 'eval-1', successRate: 0.92, coverage: 0.86, lastRunAt: new Date('2026-04-29T12:00:00.000Z') }],
    incidents: [{ id: 'inc-1', detectedAt: new Date('2026-04-15T12:00:00.000Z'), submittedAt: new Date('2026-04-16T12:00:00.000Z'), severity: 'rights_infringement', summary: 'Incorrect rejection explanation.' }],
    alertDeliveries: [{ id: 'alert-1', channel: 'email', deliveredAt: new Date('2026-04-15T12:01:00.000Z'), status: 'delivered' }],
    signedRunRoots: [signed],
  }
}

describe('compileAnnexIV', () => {
  it('produces a PDF and all eight populated sections', () => {
    const output = compileAnnexIV(fixture())
    expect(Buffer.isBuffer(output.pdf)).toBe(true)
    expect(output.pdf.length).toBeGreaterThan(1000)
    expect(output.json.sections).toHaveLength(8)
    for (const section of output.json.sections) {
      expect(section.summary.length).toBeGreaterThan(0)
      expect(section.evidence.length).toBeGreaterThan(0)
      expect(section.articleRefs.length).toBeGreaterThan(0)
    }
  })

  it('keeps the Annex IV cover metadata in JSON', () => {
    const output = compileAnnexIV(fixture())
    expect(output.json.projectName).toBe('Hiring Copilot')
    expect(output.json.declaredRoles).toEqual(['deployer', 'provider'])
    expect(output.json.organisation.name).toBe('Fuze Test Ltd')
  })

  it('still emits all eight sections for an empty evidence window', () => {
    const empty = { ...fixture(), spans: [], suspendedRuns: [], oversightDecisions: [], signedRunRoots: [] }
    const output = compileAnnexIV(empty)
    expect(output.pdf.length).toBeGreaterThan(1000)
    expect(output.json.sections).toHaveLength(8)
    expect(output.json.sections.find((s) => s.id === 'annex-iv-3')?.metrics.chainHead).toBe('0'.repeat(64))
  })

  it('counts approved tool execution spans as robustness evidence', () => {
    const input = fixture()
    const chain = new HashChain<EvidenceSpan>()
    const approved = span('tool.execute.approved', 'tool', {
      'gen_ai.tool.name': 'candidate-record',
      'fuze.tool.outcome': 'value',
      'fuze.data_classification': 'personal',
    })
    const output = compileAnnexIV({ ...input, spans: [chain.append(approved)] })
    const robustness = output.json.sections.find((s) => s.id === 'annex-iv-6')
    expect(robustness?.metrics.toolExecutions).toBe(1)
  })
})
