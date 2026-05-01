import type {
  AgentDefinitionForReport,
  AnnexIvFinding,
  AnnexIvMapping,
  AnnexIvReport,
  EvidenceRecord,
} from './types.js'

export interface GenerateAnnexIvReportInput {
  readonly records: readonly EvidenceRecord[]
  readonly agentDefinition: AgentDefinitionForReport
  readonly mapping: AnnexIvMapping
  readonly now?: () => Date
}

const spanAttributeKeys = (record: EvidenceRecord): readonly string[] => {
  const span = record.payload
  const envelopeKeys: string[] = []
  if (typeof record.hash === 'string' && record.hash.length > 0) envelopeKeys.push('fuze.evidence.hash')
  if (typeof record.prevHash === 'string') envelopeKeys.push('fuze.evidence.prev_hash')
  if (typeof record.sequence === 'number') envelopeKeys.push('fuze.evidence.sequence')
  const structuralKeys: string[] = []
  if (typeof span.runId === 'string' && span.runId.length > 0) structuralKeys.push('fuze.run.id')
  if (typeof span.stepId === 'string' && span.stepId.length > 0) structuralKeys.push('fuze.step.id')
  if (typeof span.role === 'string' && span.role.length > 0) structuralKeys.push('fuze.span.role')
  if (typeof span.span === 'string' && span.span.length > 0) structuralKeys.push('fuze.span.name')
  return [...envelopeKeys, ...structuralKeys, ...Object.keys(span.common), ...Object.keys(span.attrs)]
}

export const generateAnnexIvReport = (input: GenerateAnnexIvReportInput): AnnexIvReport => {
  const { records, agentDefinition, mapping } = input
  const now = input.now ? input.now() : new Date()

  const recordKeys: ReadonlyArray<ReadonlySet<string>> = records.map(
    (r) => new Set(spanAttributeKeys(r)),
  )

  const findings: AnnexIvFinding[] = mapping.sections.map((section) => {
    const matchedAttrs = new Set<string>()
    let matchedSpanCount = 0
    for (const keys of recordKeys) {
      let matchedThisSpan = false
      for (const attr of section.attributes) {
        if (keys.has(attr)) {
          matchedAttrs.add(attr)
          matchedThisSpan = true
        }
      }
      if (matchedThisSpan) matchedSpanCount++
    }
    return {
      sectionId: section.id,
      title: section.title,
      attributes: section.attributes,
      matchedSpanCount,
      matchedAttributes: [...matchedAttrs].sort(),
      isGap: matchedSpanCount === 0,
    }
  })

  const gaps = findings.filter((f) => f.isGap).map((f) => f.sectionId)

  return {
    version: '1',
    mappingId: mapping.id,
    mappingTitle: mapping.title,
    mappingVersion: mapping.version,
    agent: {
      purpose: agentDefinition.purpose,
      lawfulBasis: agentDefinition.lawfulBasis,
      annexIIIDomain: agentDefinition.annexIIIDomain,
      producesArt22Decision: agentDefinition.producesArt22Decision,
      retentionPolicyId: agentDefinition.retention.id,
    },
    totalSpans: records.length,
    findings,
    gaps,
    generatedAt: now.toISOString(),
  }
}
