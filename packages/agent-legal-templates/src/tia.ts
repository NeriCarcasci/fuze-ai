import type { TiaInput } from './types.js'

const DISCLAIMER = `> **NOT LEGAL ADVICE.** This Transfer Impact Assessment is a generated template. The third-country law analysis must be filled in by counsel familiar with the importer's jurisdiction.`

const lawyerReview = (note: string): string => `<!-- LAWYER REVIEW: ${note} -->`

const requireField = (cond: boolean, name: string): void => {
  if (!cond) throw new Error(`generateTia: required field "${name}" is missing or empty`)
}

export const generateTia = (input: TiaInput): string => {
  requireField(input.subProcessor.name.length > 0, 'subProcessor.name')
  requireField(input.dataFlows.length > 0, 'dataFlows')
  requireField(input.transferPurpose.length > 0, 'transferPurpose')

  const sp = input.subProcessor
  const sm = input.supplementaryMeasures

  const flowRows = input.dataFlows
    .map((f) => `| ${f.category} | ${f.classification} | ${f.purpose} |`)
    .join('\n')

  return `# Transfer Impact Assessment (Schrems II / EDPB 01/2020)

${DISCLAIMER}

**Importer:** ${sp.name} (${sp.country}) — role: ${sp.role}

**Exporter (controller):** ${input.controller.legalName} (${input.controller.country})

**Exporter (processor / data exporter to importer):** ${input.processor.legalName} (${input.processor.country})

## 1. Description of the transfer

Purpose: ${input.transferPurpose}

Lawful basis: \`${input.lawfulBasis}\`

Retention policy: \`${input.retention.id}\` (full content ${input.retention.fullContentTtlDays}d, hashes ${input.retention.hashTtlDays}d, decisions ${input.retention.decisionTtlDays}d)

### 1.1 Data flows

| Category | Classification | Purpose |
|---|---|---|
${flowRows}

## 2. Third-country law analysis

${lawyerReview(`Provide an analysis of ${sp.country} surveillance laws (e.g. equivalents of FISA 702, EO 12333, national-security access regimes) and onward-transfer rules. Cite primary sources.`)}

_Conclusion (filled by counsel):_ \`<insert: essentially equivalent / not equivalent / equivalent with measures>\`

## 3. Effectiveness of supplementary measures

### 3.1 Encryption

${sm.encryption}

### 3.2 Pseudonymisation

${sm.pseudonymisation}

### 3.3 Contractual measures

${sm.contractual}

${lawyerReview('Confirm SCC Module selected matches the role mapping in this transfer; verify docking-clause inclusion.')}

### 3.4 Organisational measures

${sm.organisational}

## 4. Overall conclusion

${lawyerReview('Reviewer must state whether the combination of SCCs plus supplementary measures provides essentially equivalent protection. If not, the transfer must be suspended or terminated per EDPB Recommendations 01/2020.')}

_Conclusion:_ \`<insert: transfer permissible / transfer permissible with conditions / transfer not permissible>\`

---

_End of TIA template. Counsel review required before any transfer is initiated._
`
}
