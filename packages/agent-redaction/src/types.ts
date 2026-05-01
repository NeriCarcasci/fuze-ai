export type PiiKind =
  | 'email'
  | 'phone'
  | 'phone-de'
  | 'phone-fr'
  | 'phone-it'
  | 'phone-es'
  | 'phone-uk'
  | 'iban'
  | 'ipv4'
  | 'ipv6'
  | 'mac'
  | 'creditCard'
  | 'jwt'
  | 'oauth-bearer'
  | 'de-steuer-id'
  | 'fr-insee'
  | 'it-codice-fiscale'
  | 'person'
  | 'location'
  | 'organization'
  | 'classifier-error'

export interface Finding {
  readonly kind: PiiKind
  readonly count: number
  readonly fields: readonly string[]
}

export interface RedactionResult {
  readonly value: unknown
  readonly findings: readonly Finding[]
  readonly confidence: number
}

export interface RedactionEngine {
  readonly name: string
  redact(value: unknown): Promise<RedactionResult>
}

export type LayeredMode = 'union' | 'intersection'
