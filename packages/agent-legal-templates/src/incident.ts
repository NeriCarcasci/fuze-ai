import type { IncidentEvent, IncidentNotification, IncidentNotificationPacket } from './types.js'

const DISCLAIMER = `> **NOT LEGAL ADVICE.** This notification packet is generated from incident metadata. The DPO and counsel must review and customize it before submission to the supervisory authority or affected data subjects.`

const lawyerReview = (note: string): string => `<!-- LAWYER REVIEW: ${note} -->`

const requireField = (cond: boolean, name: string): void => {
  if (!cond)
    throw new Error(`generateBreachNotification: required field "${name}" is missing or empty`)
}

const buildArt33 = (e: IncidentEvent): IncidentNotificationPacket => {
  const json: Record<string, unknown> = {
    type: 'gdpr-art-33',
    incidentId: e.id,
    detectedAt: e.detectedAt,
    discoveredAt: e.discoveredAt,
    severity: e.severity,
    controller: {
      legalName: e.controller.legalName,
      country: e.controller.country,
      contactEmail: e.controller.contactEmail,
    },
    dpoContact: e.dpoContact,
    supervisoryAuthority: e.supervisoryAuthority,
    natureOfBreach: e.natureOfBreach,
    affectedSubjectCount: e.affectedSubjectCount,
    affectedDataCategories: [...e.affectedDataCategories],
    likelyConsequences: e.likelyConsequences,
    measuresTaken: e.measuresTaken,
  }

  const markdown = `# Personal Data Breach Notification — GDPR Art. 33

${DISCLAIMER}

**Incident ID:** ${e.id}
**Detected at:** ${e.detectedAt}
**Discovered at:** ${e.discoveredAt}
**Severity:** ${e.severity}

## 1. Controller

- ${e.controller.legalName}
- ${e.controller.address}
- ${e.controller.country}
- Contact: ${e.controller.contactEmail}
- DPO: ${e.dpoContact}

## 2. Supervisory authority

${e.supervisoryAuthority}

## 3. Nature of the breach

${e.natureOfBreach}

## 4. Categories and approximate number of data subjects

- Approximate count: ${e.affectedSubjectCount}
- Categories of data: ${e.affectedDataCategories.join(', ')}

## 5. Likely consequences

${e.likelyConsequences}

## 6. Measures taken or proposed

${e.measuresTaken}

${lawyerReview('Confirm 72-hour clock from "becoming aware"; document any delay justification per Art. 33(1).')}
`
  return { markdown, json }
}

const buildArt34 = (e: IncidentEvent): IncidentNotificationPacket => {
  const json: Record<string, unknown> = {
    type: 'gdpr-art-34',
    incidentId: e.id,
    discoveredAt: e.discoveredAt,
    controller: {
      legalName: e.controller.legalName,
      contactEmail: e.controller.contactEmail,
    },
    dpoContact: e.dpoContact,
    natureOfBreach: e.natureOfBreach,
    likelyConsequences: e.likelyConsequences,
    measuresTaken: e.measuresTaken,
  }

  const markdown = `# Notice to Affected Data Subjects — GDPR Art. 34

${DISCLAIMER}

**Incident ID:** ${e.id}
**Date:** ${e.discoveredAt}

## What happened

${e.natureOfBreach}

## What information was involved

${e.affectedDataCategories.join(', ')}

## What this may mean for you

${e.likelyConsequences}

## What we are doing

${e.measuresTaken}

## How to reach us

- Controller: ${e.controller.legalName} — ${e.controller.contactEmail}
- Data Protection Officer: ${e.dpoContact}

${lawyerReview('Notice must be in clear and plain language (Art. 34(2)); confirm tone and translations for all relevant jurisdictions.')}
`
  return { markdown, json }
}

export const generateBreachNotification = (event: IncidentEvent): IncidentNotification => {
  requireField(event.id.length > 0, 'id')
  requireField(event.detectedAt.length > 0, 'detectedAt')
  requireField(event.discoveredAt.length > 0, 'discoveredAt')
  requireField(event.natureOfBreach.length > 0, 'natureOfBreach')
  requireField(event.controller.legalName.length > 0, 'controller.legalName')

  return {
    art33: buildArt33(event),
    art34: event.highRisk ? buildArt34(event) : null,
  }
}
