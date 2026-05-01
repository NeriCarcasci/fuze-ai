import type {
  AgentDefinition,
  DataClassification,
  GdprLawfulBasis,
  Residency,
  RetentionPolicy,
} from '@fuze-ai/agent'

export type ProcessorRole = 'controller' | 'processor'

export interface PartyRef {
  readonly legalName: string
  readonly address: string
  readonly country: string
  readonly contactEmail: string
}

export interface DpaSecurityMeasures {
  readonly evidenceSigner: string
  readonly transparencyLog: string
  readonly encryptionAtRest: string
  readonly encryptionInTransit: string
  readonly accessControl: string
}

export interface DpaSubProcessor {
  readonly name: string
  readonly role: string
  readonly country: string
  readonly residency: Residency
  readonly transferMechanism?: 'adequacy' | 'scc' | 'bcr' | 'derogation' | 'none'
}

export interface DpaInput {
  readonly controller: PartyRef
  readonly processor: PartyRef
  readonly definition: AgentDefinition<unknown, unknown>
  readonly subjectCategories: readonly string[]
  readonly durationDescription: string
  readonly securityMeasures: DpaSecurityMeasures
  readonly subProcessors: readonly DpaSubProcessor[]
  readonly governingLaw?: string
}

export type AdequacyStatus = 'eu' | 'eea' | 'adequacy' | 'none'

export interface TransferContext {
  readonly controllerCountry: string
  readonly processorCountry: string
  readonly controllerRole: ProcessorRole
  readonly processorRole: ProcessorRole
  readonly controllerAdequacy: AdequacyStatus
  readonly processorAdequacy: AdequacyStatus
}

export type SccModule =
  | 'module-1-c2c'
  | 'module-2-c2p'
  | 'module-3-p2p'
  | 'module-4-p2c'

export interface SccSelection {
  readonly required: boolean
  readonly modules: readonly SccModule[]
  readonly rationale: string
  readonly dockingClause: boolean
  readonly requiresTia: boolean
  readonly editionRef: string
  readonly customizationsRequired: readonly string[]
}

export interface TiaDataFlow {
  readonly category: string
  readonly classification: DataClassification
  readonly purpose: string
}

export interface TiaSupplementaryMeasures {
  readonly encryption: string
  readonly pseudonymisation: string
  readonly contractual: string
  readonly organisational: string
}

export interface TiaInput {
  readonly subProcessor: DpaSubProcessor
  readonly controller: PartyRef
  readonly processor: PartyRef
  readonly dataFlows: readonly TiaDataFlow[]
  readonly lawfulBasis: GdprLawfulBasis
  readonly retention: RetentionPolicy
  readonly supplementaryMeasures: TiaSupplementaryMeasures
  readonly transferPurpose: string
}

export interface SubProcessor {
  readonly name: string
  readonly role: string
  readonly country: string
  readonly residency: Residency
  readonly dataCategories: readonly string[]
  readonly addedAt: string
}

export interface Manifest {
  readonly version: '1'
  readonly hash: string
  readonly subProcessors: readonly SubProcessor[]
}

export interface ManifestDiff {
  readonly added: readonly SubProcessor[]
  readonly removed: readonly SubProcessor[]
  readonly changed: readonly { readonly prev: SubProcessor; readonly next: SubProcessor }[]
}

export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical'

export interface IncidentEvent {
  readonly id: string
  readonly detectedAt: string
  readonly discoveredAt: string
  readonly severity: IncidentSeverity
  readonly affectedSubjectCount: number
  readonly affectedDataCategories: readonly string[]
  readonly natureOfBreach: string
  readonly likelyConsequences: string
  readonly measuresTaken: string
  readonly highRisk: boolean
  readonly controller: PartyRef
  readonly dpoContact: string
  readonly supervisoryAuthority: string
}

export interface IncidentNotificationPacket {
  readonly markdown: string
  readonly json: Record<string, unknown>
}

export interface IncidentNotification {
  readonly art33: IncidentNotificationPacket
  readonly art34: IncidentNotificationPacket | null
}
