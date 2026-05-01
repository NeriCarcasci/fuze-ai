import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { generateAnnexIvReport } from '../src/report.js'
import { commissionAnnexIvMapping } from '../src/mappings/commission.js'
import type { AgentDefinitionForReport, EvidenceRecord } from '../src/types.js'
import {
  makeTenantId,
  makePrincipalId,
  makeRunId,
  makeStepId,
  DEFAULT_RETENTION,
  type EvidenceSpan,
  type SpanCommonAttrs,
} from '@fuze-ai/agent'

const baseCommon: SpanCommonAttrs = {
  'fuze.tenant.id': makeTenantId('tenant-a'),
  'fuze.principal.id': makePrincipalId('principal-a'),
  'fuze.lawful_basis': 'contract',
  'fuze.annex_iii_domain': 'employment',
  'fuze.art22_decision': false,
  'fuze.retention.policy_id': DEFAULT_RETENTION.id,
}

const makeRecord = (
  attrs: Readonly<Record<string, unknown>>,
  sequence: number,
  span = 'agent.step',
): EvidenceRecord => ({
  sequence,
  prevHash: '0'.repeat(64),
  hash: 'a'.repeat(64),
  payload: {
    span,
    role: 'agent',
    runId: makeRunId('run-1'),
    stepId: makeStepId(`step-${sequence}`),
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:00:01.000Z',
    common: baseCommon,
    attrs,
  } satisfies EvidenceSpan,
})

const agent: AgentDefinitionForReport = {
  purpose: 'Triage employee benefits questions',
  lawfulBasis: 'contract',
  annexIIIDomain: 'employment',
  producesArt22Decision: false,
  model: { provider: 'stub', model: 'stub-1' } as never,
  tools: [],
  guardrails: { input: [], toolResult: [], output: [] } as never,
  output: z.object({}).passthrough() as never,
  maxSteps: 5,
  retryBudget: 0,
  retention: DEFAULT_RETENTION,
  deps: {},
}

describe('generateAnnexIvReport', () => {
  it('empty records → all sections are gaps', () => {
    const report = generateAnnexIvReport({
      records: [],
      agentDefinition: agent,
      mapping: commissionAnnexIvMapping,
    })
    expect(report.totalSpans).toBe(0)
    expect(report.gaps.length).toBe(commissionAnnexIvMapping.sections.length)
    for (const f of report.findings) {
      expect(f.isGap).toBe(true)
      expect(f.matchedSpanCount).toBe(0)
    }
  })

  it('full coverage → no gaps', () => {
    const allAttrs: Record<string, unknown> = {}
    for (const section of commissionAnnexIvMapping.sections) {
      for (const a of section.attributes) {
        allAttrs[a] = 'present'
      }
    }
    const records = [makeRecord(allAttrs, 0)]
    const report = generateAnnexIvReport({
      records,
      agentDefinition: agent,
      mapping: commissionAnnexIvMapping,
    })
    expect(report.gaps).toEqual([])
    for (const f of report.findings) {
      expect(f.isGap).toBe(false)
    }
  })

  it('partial coverage → correct gap list', () => {
    const records = [
      makeRecord({ 'gen_ai.request.model': 'gpt-4o', 'gen_ai.usage.input_tokens': 10 }, 0),
    ]
    const report = generateAnnexIvReport({
      records,
      agentDefinition: agent,
      mapping: commissionAnnexIvMapping,
    })
    const matchedIds = report.findings.filter((f) => !f.isGap).map((f) => f.sectionId)
    expect(matchedIds).toContain('§3(a) technical specifications')
    expect(matchedIds).toContain('§3(b) computational resources')
    expect(matchedIds).toContain('§4(a) automatic logging') // common attrs include fuze.tenant.id
    expect(report.gaps).toContain('§5(a) test reporting')
    expect(report.gaps).toContain('§7(b) serious incident reporting')
  })

  it('counts matched spans accurately', () => {
    const records = [
      makeRecord({ 'gen_ai.request.model': 'm' }, 0),
      makeRecord({ 'gen_ai.request.model': 'm' }, 1),
      makeRecord({}, 2),
    ]
    const report = generateAnnexIvReport({
      records,
      agentDefinition: agent,
      mapping: commissionAnnexIvMapping,
    })
    const tech = report.findings.find((f) => f.sectionId === '§3(a) technical specifications')
    expect(tech?.matchedSpanCount).toBe(2)
  })

  it('report references the agent definition', () => {
    const report = generateAnnexIvReport({
      records: [],
      agentDefinition: agent,
      mapping: commissionAnnexIvMapping,
    })
    expect(report.agent.purpose).toBe(agent.purpose)
    expect(report.agent.lawfulBasis).toBe(agent.lawfulBasis)
    expect(report.agent.annexIIIDomain).toBe(agent.annexIIIDomain)
    expect(report.agent.retentionPolicyId).toBe(DEFAULT_RETENTION.id)
  })

  it('report is JSON-serializable', () => {
    const records = [makeRecord({ 'gen_ai.request.model': 'm' }, 0)]
    const report = generateAnnexIvReport({
      records,
      agentDefinition: agent,
      mapping: commissionAnnexIvMapping,
    })
    const json = JSON.stringify(report)
    const parsed: unknown = JSON.parse(json)
    expect(parsed).toBeTypeOf('object')
  })

  it('emits matchedAttributes per finding sorted', () => {
    const records = [
      makeRecord({ 'gen_ai.request.model': 'm', 'gen_ai.request.temperature': 0.2 }, 0),
    ]
    const report = generateAnnexIvReport({
      records,
      agentDefinition: agent,
      mapping: commissionAnnexIvMapping,
    })
    const tech = report.findings.find((f) => f.sectionId === '§3(a) technical specifications')
    expect(tech?.matchedAttributes).toEqual(['gen_ai.request.model', 'gen_ai.request.temperature'])
  })
})
