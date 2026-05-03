import { describe, expect, it } from 'vitest'
import { compileIncidentReport, deadlineFor, type IncidentInput, type IncidentSeverity } from '../src/index.js'

const input = (): IncidentInput => ({
  organisation: { id: 'org-1', name: 'Fuze Test Ltd', contact: 'compliance@example.test' },
  affectedSystems: [
    { id: 'system-1', name: 'Hiring Copilot', deploymentDate: new Date('2026-01-15T00:00:00.000Z') },
  ],
  incident: {
    detectedAt: new Date('2026-05-01T10:00:00.000Z'),
    summary: 'Candidate recommendations were unavailable for a production hiring workflow.',
    severity: 'significant_disruption',
    affectedPersonsEstimate: 42,
  },
  rootCause: { description: 'A downstream tool returned repeated schema-invalid responses.', categoryTags: ['tool-error', 'schema'] },
  evidenceRefs: {
    runIds: ['run-1'],
    chainHeads: ['a'.repeat(64)],
    suspendedRunIds: ['run-1'],
  },
  mitigationsApplied: [{ description: 'Disabled the affected workflow and routed cases to manual review.', appliedAt: new Date('2026-05-01T11:00:00.000Z') }],
  notifications: [{ authority: 'Irish competent authority', submittedAt: new Date('2026-05-02T09:00:00.000Z'), reference: 'ART73-1' }],
})

describe('deadlineFor', () => {
  it.each([
    ['serious_harm', 48],
    ['significant_disruption', 360],
    ['rights_infringement', 360],
    ['other', 360],
  ] as readonly (readonly [IncidentSeverity, number])[])('returns %s window', (severity, hours) => {
    const deadline = deadlineFor(severity)
    expect(deadline.hours).toBe(hours)
    expect(Date.parse(deadline.isoBy)).toBeGreaterThan(0)
  })
})

describe('compileIncidentReport', () => {
  it('renders the full fixture and deterministic detected-at deadline', () => {
    const report = compileIncidentReport(input())
    expect(report.pdf.length).toBeGreaterThan(1000)
    expect(report.json.articleRefs).toContain('Article 73')
    expect(report.json.deadline.hours).toBe(360)
    expect(report.json.deadline.isoBy).toBe('2026-05-16T10:00:00.000Z')
    expect(report.json.evidenceRefs.chainHeads[0]).toBe('a'.repeat(64))
    expect(report.json.timeline.length).toBeGreaterThanOrEqual(3)
  })

  it.each([
    ['serious_harm', '2026-05-03T10:00:00.000Z'],
    ['significant_disruption', '2026-05-16T10:00:00.000Z'],
    ['rights_infringement', '2026-05-16T10:00:00.000Z'],
    ['other', '2026-05-16T10:00:00.000Z'],
  ] as readonly (readonly [IncidentSeverity, string])[])('calculates detected-at deadline for %s', (severity, isoBy) => {
    const fixture = input()
    const report = compileIncidentReport({
      ...fixture,
      incident: { ...fixture.incident, severity },
    })
    expect(report.json.deadline.isoBy).toBe(isoBy)
  })
})
