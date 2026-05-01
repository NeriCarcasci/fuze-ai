declare const secretBrand: unique symbol

export interface SecretRef {
  readonly [secretBrand]: true
  readonly id: string
}

export interface SecretsHandle {
  ref(id: string): SecretRef
  resolve(ref: SecretRef): Promise<string>
}

export const SECRET_REDACTED = '<<fuze:secret:redacted>>' as const
