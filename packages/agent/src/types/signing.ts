export interface SignedRunRoot {
  readonly runId: string
  readonly chainHead: string
  readonly nonce: string
  readonly signature: string
  readonly publicKeyId: string
  readonly algorithm: 'ed25519'
}

export interface Ed25519Signer {
  readonly publicKeyId: string
  sign(message: Uint8Array): Promise<Uint8Array>
}

export interface Ed25519Verifier {
  verify(publicKeyId: string, message: Uint8Array, signature: Uint8Array): Promise<boolean>
}

export class SignerUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SignerUnavailableError'
  }
}
