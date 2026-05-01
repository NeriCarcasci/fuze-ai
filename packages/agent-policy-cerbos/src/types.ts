export type RuleEffect =
  | 'EFFECT_ALLOW'
  | 'EFFECT_DENY'
  | 'EFFECT_REQUIRES_APPROVAL'
  | 'allow'
  | 'deny'
  | 'requires-approval'

export interface Condition {
  readonly match: {
    readonly expr: string
  }
}

export interface Rule {
  readonly id?: string
  readonly actions: readonly string[]
  readonly effect: RuleEffect
  readonly condition?: Condition
}

export interface ResourcePolicy {
  readonly apiVersion: string
  readonly resourcePolicy: {
    readonly resource: string
    readonly version?: string
    readonly rules: readonly Rule[]
  }
}

export class PolicyLoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PolicyLoadError'
  }
}
