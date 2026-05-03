import type {
  AgentDefinition,
  ChainedRecord,
  EvidenceSpan,
  SignedRunRoot,
  SuspendedRun,
} from '@fuze-ai/agent'

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

export type DeclaredRole = 'deployer' | 'provider' | 'component_supplier'

export interface OversightDecisionRecord {
  readonly runId: string
  readonly action: 'approve' | 'reject' | 'halt' | 'override'
  readonly rationale?: string
  readonly decidedAt: Date
  readonly requestedAt?: Date
  readonly overseerId?: string
}

export interface EvalRunSummary {
  readonly id: string
  readonly successRate: number
  readonly coverage: number
  readonly lastRunAt: Date
}

export interface IncidentRecord {
  readonly id: string
  readonly submittedAt?: Date
  readonly detectedAt: Date
  readonly severity: string
  readonly summary: string
}

export interface AlertDeliveryRecord {
  readonly id: string
  readonly channel: string
  readonly deliveredAt: Date
  readonly status: 'delivered' | 'failed' | 'pending'
}

export interface AnnexIVInput {
  readonly projectId: string
  readonly projectName: string
  readonly organisation: { readonly id: string; readonly name: string; readonly address: string }
  readonly declaredRoles: {
    readonly deployer: boolean
    readonly provider: boolean
    readonly component_supplier: boolean
  }
  readonly dateRange: { readonly from: Date; readonly to: Date }
  readonly spans: readonly ChainedRecord<EvidenceSpan>[]
  readonly suspendedRuns: readonly SuspendedRun[]
  readonly oversightDecisions: readonly OversightDecisionRecord[]
  readonly evalResults?: readonly EvalRunSummary[]
  readonly incidents?: readonly IncidentRecord[]
  readonly alertDeliveries?: readonly AlertDeliveryRecord[]
  readonly signedRunRoots: readonly SignedRunRoot[]
}

export interface AnnexIVSectionReport {
  readonly id: string
  readonly title: string
  readonly articleRefs: readonly string[]
  readonly summary: string
  readonly metrics: Readonly<Record<string, string | number | boolean>>
  readonly evidence: readonly string[]
}

export interface AnnexIVReport {
  readonly version: '1'
  readonly projectId: string
  readonly projectName: string
  readonly organisation: { readonly id: string; readonly name: string; readonly address: string }
  readonly declaredRoles: readonly DeclaredRole[]
  readonly dateRange: { readonly from: string; readonly to: string }
  readonly generatedAt: string
  readonly sections: readonly AnnexIVSectionReport[]
}
