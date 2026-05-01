import type { Ed25519Signer, Ed25519Verifier } from '@fuze-ai/agent'
import { CircuitBreaker, type CircuitBreakerOptions } from './circuit-breaker.js'
import { KmsUnavailableError } from './errors.js'

export interface AzureKvSignResult {
  result: Uint8Array
  keyID?: string
}

export interface AzureKvVerifyResult {
  result: boolean
}

export interface AzureKvLikeClient {
  sign(algorithm: 'EdDSA', message: Uint8Array): Promise<AzureKvSignResult>
  verify(algorithm: 'EdDSA', message: Uint8Array, signature: Uint8Array): Promise<AzureKvVerifyResult>
}

export interface AzureKvSignerOptions {
  keyId: string
  client?: AzureKvLikeClient
  circuitBreaker?: CircuitBreakerOptions
}

async function loadAzureClient(keyId: string): Promise<AzureKvLikeClient> {
  let mod: {
    CryptographyClient: new (keyId: string, credential: unknown) => AzureKvLikeClient
  }
  let identity: { DefaultAzureCredential: new () => unknown }
  try {
    mod = (await import('@azure/keyvault-keys')) as unknown as typeof mod
  } catch {
    throw new KmsUnavailableError(
      'optional dependency @azure/keyvault-keys is not installed; run `npm i @azure/keyvault-keys @azure/identity` or pass a client'
    )
  }
  try {
    identity = (await import('@azure/identity' as string)) as unknown as typeof identity
  } catch {
    throw new KmsUnavailableError(
      'optional dependency @azure/identity is not installed; run `npm i @azure/identity` or pass a client'
    )
  }
  return new mod.CryptographyClient(keyId, new identity.DefaultAzureCredential())
}

export class AzureKvSigner implements Ed25519Signer {
  readonly publicKeyId: string
  private readonly keyId: string
  private readonly breaker: CircuitBreaker
  private clientPromise: Promise<AzureKvLikeClient> | null

  constructor(options: AzureKvSignerOptions) {
    this.keyId = options.keyId
    this.publicKeyId = options.keyId
    this.breaker = new CircuitBreaker(options.circuitBreaker)
    this.clientPromise = options.client ? Promise.resolve(options.client) : null
  }

  private async client(): Promise<AzureKvLikeClient> {
    if (!this.clientPromise) {
      this.clientPromise = loadAzureClient(this.keyId)
    }
    return this.clientPromise
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    return this.breaker.run(async () => {
      const c = await this.client()
      const out = await c.sign('EdDSA', message)
      if (!out.result) throw new Error('Azure Key Vault sign returned no result')
      return out.result
    })
  }
}

export interface AzureKvVerifierOptions {
  keyId: string
  client?: AzureKvLikeClient
  circuitBreaker?: CircuitBreakerOptions
}

export class AzureKvVerifier implements Ed25519Verifier {
  private readonly keyId: string
  private readonly breaker: CircuitBreaker
  private clientPromise: Promise<AzureKvLikeClient> | null

  constructor(options: AzureKvVerifierOptions) {
    this.keyId = options.keyId
    this.breaker = new CircuitBreaker(options.circuitBreaker)
    this.clientPromise = options.client ? Promise.resolve(options.client) : null
  }

  private async client(): Promise<AzureKvLikeClient> {
    if (!this.clientPromise) {
      this.clientPromise = loadAzureClient(this.keyId)
    }
    return this.clientPromise
  }

  async verify(publicKeyId: string, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    if (publicKeyId !== this.keyId) return false
    return this.breaker.run(async () => {
      const c = await this.client()
      const out = await c.verify('EdDSA', message, signature)
      return out.result === true
    })
  }
}
