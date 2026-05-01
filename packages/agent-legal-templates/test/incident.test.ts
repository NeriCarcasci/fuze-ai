import { describe, expect, it } from 'vitest'
import { generateBreachNotification } from '../src/incident.js'
import type { IncidentEvent } from '../src/types.js'
import { controllerParty } from './fixtures.js'

const event = (overrides: Partial<IncidentEvent> = {}): IncidentEvent => ({
  id: 'inc-2026-04-30-001',
  detectedAt: '2026-04-30T11:30:00Z',
  discoveredAt: '2026-04-30T12:00:00Z',
  severity: 'high',
  affectedSubjectCount: 1200,
  affectedDataCategories: ['email', 'name'],
  natureOfBreach: 'Unauthorised access to a CRM export file via leaked API key.',
  likelyConsequences: 'Possible phishing targeted at affected customers.',
  measuresTaken: 'Key revoked, file access disabled, customers notified, monitoring increased.',
  highRisk: true,
  controller: controllerParty,
  dpoContact: 'dpo@acme.example',
  supervisoryAuthority: 'Berlin Commissioner for Data Protection (BlnBDI)',
  ...overrides,
})

describe('generateBreachNotification', () => {
  it('always generates an Art. 33 supervisory-authority notification', () => {
    const r = generateBreachNotification(event())
    expect(r.art33.markdown).toContain('# Personal Data Breach Notification — GDPR Art. 33')
    expect(r.art33.markdown).toContain('Berlin Commissioner for Data Protection')
    expect(r.art33.json['type']).toBe('gdpr-art-33')
  })

  it('generates an Art. 34 data-subject notice when highRisk is true', () => {
    const r = generateBreachNotification(event({ highRisk: true }))
    expect(r.art34).not.toBeNull()
    expect(r.art34?.markdown).toContain('# Notice to Affected Data Subjects — GDPR Art. 34')
  })

  it('omits Art. 34 when highRisk is false', () => {
    const r = generateBreachNotification(event({ highRisk: false }))
    expect(r.art34).toBeNull()
  })

  it('produces structured JSON that round-trips through JSON.stringify/parse', () => {
    const r = generateBreachNotification(event())
    const round = JSON.parse(JSON.stringify(r.art33.json)) as Record<string, unknown>
    expect(round['incidentId']).toBe('inc-2026-04-30-001')
    expect(round['affectedDataCategories']).toEqual(['email', 'name'])
  })

  it('includes the incident ID and timestamps in the markdown', () => {
    const r = generateBreachNotification(event())
    expect(r.art33.markdown).toContain('inc-2026-04-30-001')
    expect(r.art33.markdown).toContain('2026-04-30T11:30:00Z')
    expect(r.art33.markdown).toContain('2026-04-30T12:00:00Z')
  })

  it('throws when nature of breach is missing', () => {
    expect(() => generateBreachNotification(event({ natureOfBreach: '' }))).toThrowError(
      /natureOfBreach/,
    )
  })
})
