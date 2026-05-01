import type {
  AnyFuzeTool,
  Art9Basis,
  DataClassification,
  GdprLawfulBasis,
  RetentionPolicy,
  ThreatBoundary,
} from '@fuze-ai/agent'

export type McpServerFingerprint = {
  readonly algorithm: 'sha256'
  readonly digest: string
}

export type McpSandboxTier = 'vm-managed' | 'vm-self-hosted' | 'in-process'

export interface McpAdmission {
  readonly serverId: string
  readonly allowedToolNames: readonly string[]
  readonly maxDescriptionLength: number
  readonly fingerprint: McpServerFingerprint
  readonly sandboxTier: McpSandboxTier
}

export interface UnverifiedToolMetadata {
  readonly dataClassification: DataClassification
  readonly retention: RetentionPolicy
  readonly threatBoundary: ThreatBoundary
  readonly lawfulBases?: readonly GdprLawfulBasis[]
  readonly art9Basis?: Art9Basis
  readonly residencyRequired?: 'eu' | 'eu-approved' | 'any'
}

export interface FuzeMcpHost {
  addServer(admission: McpAdmission): Promise<void>
  listTools(): readonly AnyFuzeTool[]
  dispose(): Promise<void>
}
