import type { AgentDefinition, ChainedRecord, EvidenceSpan } from '@fuze-ai/agent'

export interface AnnexIvSection {
  readonly id: string
  readonly title: string
  readonly attributes: readonly string[]
}

export interface AnnexIvMapping {
  readonly id: string
  readonly title: string
  readonly version: string
  readonly sections: readonly AnnexIvSection[]
}

export interface AnnexIvFinding {
  readonly sectionId: string
  readonly title: string
  readonly attributes: readonly string[]
  readonly matchedSpanCount: number
  readonly matchedAttributes: readonly string[]
  readonly isGap: boolean
}

export interface AnnexIvAgentRef {
  readonly purpose: string
  readonly lawfulBasis: string
  readonly annexIIIDomain: string
  readonly producesArt22Decision: boolean
  readonly retentionPolicyId: string
}

export interface AnnexIvReport {
  readonly version: '1'
  readonly mappingId: string
  readonly mappingTitle: string
  readonly mappingVersion: string
  readonly agent: AnnexIvAgentRef
  readonly totalSpans: number
  readonly findings: readonly AnnexIvFinding[]
  readonly gaps: readonly string[]
  readonly generatedAt: string
}

export type EvidenceRecord = ChainedRecord<EvidenceSpan>

export type AgentDefinitionForReport = AgentDefinition<unknown, unknown>
