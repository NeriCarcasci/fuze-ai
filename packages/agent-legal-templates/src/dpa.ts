import type { DataClassification } from '@fuze-ai/agent'
import type { DpaInput, DpaSubProcessor } from './types.js'

const DISCLAIMER = `> **NOT LEGAL ADVICE.** This document is a generated template. A qualified data-protection lawyer must review and customize it before any execution or customer use.`

const lawyerReview = (note: string): string => `<!-- LAWYER REVIEW: ${note} -->`

const partyBlock = (label: string, p: DpaInput['controller']): string =>
  [
    `**${label}**`,
    `- Legal name: ${p.legalName}`,
    `- Address: ${p.address}`,
    `- Country: ${p.country}`,
    `- Contact: ${p.contactEmail}`,
  ].join('\n')

const dataCategoriesFromTools = (input: DpaInput): readonly string[] => {
  const seen = new Set<DataClassification>()
  for (const t of input.definition.tools) {
    seen.add(t.dataClassification)
  }
  const labels: Record<DataClassification, string> = {
    public: 'Non-personal / public data',
    business: 'Business / pseudonymous identifiers',
    personal: 'Personal data (Art. 4(1) GDPR)',
    'special-category': 'Special-category data (Art. 9 GDPR)',
  }
  return [...seen].map((c) => labels[c])
}

const subProcessorTable = (subs: readonly DpaSubProcessor[]): string => {
  if (subs.length === 0) {
    return '_No sub-processors at the time of generation. Any addition triggers the change-notice procedure (see Section 8)._'
  }
  const header = '| Name | Role | Country | Residency | Transfer mechanism |\n|---|---|---|---|---|'
  const rows = subs.map(
    (s) =>
      `| ${s.name} | ${s.role} | ${s.country} | ${s.residency} | ${s.transferMechanism ?? 'n/a'} |`,
  )
  return [header, ...rows].join('\n')
}

const requireField = (cond: boolean, name: string): void => {
  if (!cond) throw new Error(`generateDpa: required field "${name}" is missing or empty`)
}

export const generateDpa = (input: DpaInput): string => {
  requireField(input.controller.legalName.length > 0, 'controller.legalName')
  requireField(input.processor.legalName.length > 0, 'processor.legalName')
  requireField(input.subjectCategories.length > 0, 'subjectCategories')
  requireField(input.durationDescription.length > 0, 'durationDescription')
  requireField(input.definition.purpose.length > 0, 'definition.purpose')

  const def = input.definition
  const dataCats = dataCategoriesFromTools(input)
  const sm = input.securityMeasures

  return `# Data Processing Agreement (GDPR Art. 28)

${DISCLAIMER}

## 1. Parties

${partyBlock('Controller', input.controller)}

${partyBlock('Processor', input.processor)}

${lawyerReview('Confirm legal capacity, signatories, and authority to bind each party.')}

## 2. Subject matter

The Processor processes personal data on behalf of the Controller solely for the purpose set out in Section 4 and in accordance with the Controller's documented instructions.

## 3. Duration

${input.durationDescription}

${lawyerReview('Align duration with the underlying main services agreement and termination clauses.')}

## 4. Nature and purpose of processing

${def.purpose}

## 5. Type of personal data

${dataCats.map((c) => `- ${c}`).join('\n')}

## 6. Categories of data subjects

${input.subjectCategories.map((c) => `- ${c}`).join('\n')}

## 7. Controller obligations

The Controller warrants that processing instructions comply with GDPR and that a valid lawful basis (Art. 6 / Art. 9) exists for each processing operation. Lawful basis declared for this engagement: \`${def.lawfulBasis}\`.

${lawyerReview('Verify lawful basis matches the actual processing operations and that any Art. 9 condition is correctly mapped.')}

## 8. Processor obligations

The Processor shall:

a. process personal data only on documented instructions from the Controller;
b. ensure persons authorised to process personal data are bound by confidentiality;
c. take all measures required pursuant to Art. 32 GDPR (see Section 11);
d. respect the conditions for engaging another processor (Section 9);
e. assist the Controller, taking into account the nature of processing, in fulfilling its obligation to respond to requests for exercising the data subject's rights;
f. assist the Controller in ensuring compliance with Art. 32 to 36 GDPR;
g. at the choice of the Controller, delete or return all personal data after the end of the provision of services (Section 14);
h. make available all information necessary to demonstrate compliance and allow for and contribute to audits (Section 13).

## 9. Sub-processors

The Processor maintains an up-to-date sub-processor manifest (content-hashed). Current sub-processors:

${subProcessorTable(input.subProcessors)}

The Controller authorises the use of the listed sub-processors. The Processor shall give the Controller at least thirty (30) days' prior notice of any intended addition or replacement, during which the Controller may object on reasonable grounds.

${lawyerReview('Adjust notice period and objection-handling clause to commercial expectations.')}

## 10. Data-subject rights

The Processor shall, taking into account the nature of the processing, assist the Controller by appropriate technical and organisational measures, insofar as this is possible, in fulfilling the Controller's obligation to respond to requests under Chapter III GDPR (Art. 15-22).

## 11. Security measures (TOMs)

The Processor implements the following technical and organisational measures:

- Evidence signing: ${sm.evidenceSigner}
- Transparency log: ${sm.transparencyLog}
- Encryption at rest: ${sm.encryptionAtRest}
- Encryption in transit: ${sm.encryptionInTransit}
- Access control: ${sm.accessControl}

${lawyerReview('Map TOMs against ISO 27001 / SOC 2 control catalogue and confirm proportionality to the risk.')}

## 12. Personal data breach notification

The Processor shall notify the Controller without undue delay and in any event within seventy-two (72) hours after becoming aware of a personal data breach affecting the Controller's personal data, and shall assist the Controller in meeting its obligations under Art. 33 and 34 GDPR.

## 13. Audit rights

The Processor shall make available to the Controller all information necessary to demonstrate compliance with Art. 28 GDPR, and allow for and contribute to audits, including inspections, conducted by the Controller or another auditor mandated by the Controller.

${lawyerReview('Define audit cadence, cost allocation, scope limits, and confidentiality obligations.')}

## 14. Deletion or return at end

Upon termination of the services, the Processor shall, at the choice of the Controller, delete or return all personal data, and delete existing copies, unless storage is required by Union or Member State law. Retention policy in force: \`${def.retention.id}\`.

## 15. Governing law

${input.governingLaw ?? '_To be specified by the parties._'}

${lawyerReview('Governing-law and jurisdiction clauses must be agreed by counsel for both parties.')}

---

_End of DPA template. Human review required before signature._
`
}
