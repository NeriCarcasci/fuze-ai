export type DataClassification = 'public' | 'business' | 'personal' | 'special-category'

export type GdprLawfulBasis =
  | 'consent'
  | 'contract'
  | 'legal-obligation'
  | 'vital-interests'
  | 'public-task'
  | 'legitimate-interests'

export type Art9Basis =
  | 'explicit-consent'
  | 'employment-social-security'
  | 'vital-interests'
  | 'non-profit-body'
  | 'manifestly-public'
  | 'legal-claims'
  | 'substantial-public-interest'
  | 'health-or-social-care'
  | 'public-health'
  | 'archiving-research-statistics'

export type AnnexIIIDomain =
  | 'none'
  | 'biometric'
  | 'critical-infrastructure'
  | 'education'
  | 'employment'
  | 'essential-services'
  | 'law-enforcement'
  | 'migration'
  | 'justice'
  | 'democratic-processes'

export type Residency = 'eu' | 'eu-approved' | 'any'

export interface RetentionPolicy {
  readonly id: string
  readonly hashTtlDays: number
  readonly fullContentTtlDays: number
  readonly decisionTtlDays: number
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  id: 'fuze.default.v1',
  hashTtlDays: 90,
  fullContentTtlDays: 30,
  decisionTtlDays: 180,
}

export interface ThreatBoundary {
  readonly trustedCallers: readonly ('agent-loop' | 'mcp-host' | 'human-overseer')[]
  readonly observesSecrets: boolean
  readonly egressDomains: readonly string[] | 'none'
  readonly readsFilesystem: boolean
  readonly writesFilesystem: boolean
}

declare const trustedInputBrand: unique symbol
export type TrustedInputOnly = { readonly [trustedInputBrand]: true }
export const TrustedInputOnly: TrustedInputOnly = {} as TrustedInputOnly

export interface SubjectRef {
  readonly hmac: string
  readonly scheme: 'hmac-sha256'
}
