import { describe, expect, it } from 'vitest'
import { compileFRIA, friaTemplate, type AnnexIIICategory, type FRIAInput } from '../src/index.js'

const inputFor = (category: AnnexIIICategory): FRIAInput => {
  const template = friaTemplate(category)
  return {
    systemDescription: {
      name: `${category} system`,
      purpose: 'Assess high-risk workflow before deployment.',
      intendedUsers: ['case officer', 'compliance officer'],
      affectedPopulation: ['applicants', 'review subjects'],
    },
    annexIIICategory: category,
    dataFlows: {
      input: [
        {
          name: 'application record',
          description: 'Structured application data and supporting evidence.',
          dataClassification: 'personal',
          sourceOrRecipient: 'deployer system',
          lawfulBasis: 'public-task',
          retentionPolicy: 'retention.v1',
        },
      ],
      output: [
        {
          name: 'risk recommendation',
          description: 'Decision-support recommendation with explanation.',
          dataClassification: 'personal',
          sourceOrRecipient: 'human reviewer',
          retentionPolicy: 'retention.v1',
        },
      ],
    },
    fundamentalRightsAssessment: template.fundamentalRightsAssessment ?? [],
    mitigations: template.mitigations ?? [],
    monitoringPlan: template.monitoringPlan ?? [],
    signOff: { name: 'A. Officer', role: 'Compliance Lead', date: new Date('2026-05-01T10:00:00.000Z') },
  }
}

describe('friaTemplate', () => {
  it('pre-fills employment-specific risks across all seven rights areas', () => {
    const template = friaTemplate('employment_screening')
    expect(template.annexIIICategory).toBe('employment_screening')
    expect(template.fundamentalRightsAssessment).toHaveLength(7)
    expect(template.fundamentalRightsAssessment?.some((s) => s.area === 'workers_rights' && s.applicable)).toBe(true)
  })

  it('pre-fills biometric risks across all seven rights areas', () => {
    const template = friaTemplate('biometric_id')
    expect(template.annexIIICategory).toBe('biometric_id')
    expect(template.fundamentalRightsAssessment).toHaveLength(7)
    expect(template.fundamentalRightsAssessment?.some((s) => s.identifiedRisk.includes('Biometric'))).toBe(true)
  })

  it.each([
    'employment_screening',
    'credit_scoring',
    'biometric_id',
    'education_access',
    'essential_services',
    'law_enforcement',
    'migration_asylum',
    'justice_democratic',
  ] as const)('covers all rights areas for %s', (category) => {
    const template = friaTemplate(category)
    expect(template.fundamentalRightsAssessment?.map((s) => s.area).sort()).toEqual([
      'child_vulnerable_groups',
      'effective_remedy_fair_trial',
      'equality_non_discrimination',
      'freedom_expression_information',
      'human_dignity',
      'privacy_data_protection',
      'workers_rights',
    ])
  })
})

describe('compileFRIA', () => {
  it.each(['employment_screening', 'credit_scoring'] as const)('renders %s reports', (category) => {
    const report = compileFRIA(inputFor(category))
    expect(report.pdf.length).toBeGreaterThan(1000)
    expect(report.json.articleRefs).toContain('Article 27')
    expect(report.json.fundamentalRightsAssessment).toHaveLength(7)
    for (const section of report.json.fundamentalRightsAssessment) {
      expect(section.identifiedRisk.length).toBeGreaterThan(0)
      expect(section.mitigation.length).toBeGreaterThan(0)
    }
  })
})
