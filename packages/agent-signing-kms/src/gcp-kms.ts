import type { Ed25519Signer, Ed25519Verifier } from '@fuze-ai/agent'
import { createPublicKey, verify as cryptoVerify } from 'node:crypto'
import { CircuitBreaker, type CircuitBreakerOptions } from './circuit-breaker.js'
import { KmsUnavailableError } from './errors.js'

export interface GcpAsymmetricSignRequest {
  name: string
  data: Uint8Array
}

export interface GcpAsymmetricSignResponse {
  signature?: Uint8Array
}

export interface GcpGetPublicKeyRequest {
  name: string
}

export interface GcpGetPublicKeyResponse {
  pem?: string
}

export interface GcpKmsLikeClient {
  asymmetricSign(req: GcpAsymmetricSignRequest): Promise<[GcpAsymmetricSignResponse]>
  getPublicKey(req: GcpGetPublicKeyRequest): Promise<[GcpGetPublicKeyResponse]>
}

export interface GcpKmsSignerOptions {
  keyName: string
  client?: GcpKmsLikeClient
  circuitBreaker?: CircuitBreakerOptions
}

async function loadGcpClient(): Promise<GcpKmsLikeClient> {
  try {
    const mod = (await import('@google-cloud/kms')) as unknown as {
      KeyManagementServiceClient: new () => GcpKmsLikeClient
    }
    return new mod.KeyManagementServiceClient()
  } catch {
    throw new KmsUnavailableError(
      'optional dependency @google-cloud/kms is not installed; run `npm i @google-cloud/kms` or pass a client'
    )
  }
}

export class GcpKmsSigner implements Ed25519Signer {
  readonly publicKeyId: string
  private readonly keyName: string
  private readonly breaker: CircuitBreaker
  private clientPromise: Promise<GcpKmsLikeClient> | null

  constructor(options: GcpKmsSignerOptions) {
    this.keyName = options.keyName
    this.publicKeyId = options.keyName
    this.breaker = new CircuitBreaker(options.circuitBreaker)
    this.clientPromise = options.client ? Promise.resolve(options.client) : null
  }

  private async client(): Promise<GcpKmsLikeClient> {
    if (!this.clientPromise) {
      this.clientPromise = loadGcpClient()
    }
    return this.clientPromise
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    return this.breaker.run(async () => {
      const c = await this.client()
      const [resp] = await c.asymmetricSign({ name: this.keyName, data: message })
      if (!resp.signature) throw new Error('GCP KMS sign returned no signature')
      return resp.signature
    })
  }
}

export interface GcpKmsVerifierOptions {
  keyName: string
  client?: GcpKmsLikeClient
  circuitBreaker?: CircuitBreakerOptions
}

export class GcpKmsVerifier implements Ed25519Verifier {
  private readonly keyName: string
  private readonly breaker: CircuitBreaker
  private clientPromise: Promise<GcpKmsLikeClient> | null

  constructor(options: GcpKmsVerifierOptions) {
    this.keyName = options.keyName
    this.breaker = new CircuitBreaker(options.circuitBreaker)
    this.clientPromise = options.client ? Promise.resolve(options.client) : null
  }

  private async client(): Promise<GcpKmsLikeClient> {
    if (!this.clientPromise) {
      this.clientPromise = loadGcpClient()
    }
    return this.clientPromise
  }

  async verify(publicKeyId: string, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    if (publicKeyId !== this.keyName) return false
    return this.breaker.run(async () => {
      const c = await this.client()
      const [resp] = await c.getPublicKey({ name: this.keyName })
      if (!resp.pem) return false
      const key = createPublicKey(resp.pem)
      return cryptoVerify(null, message, key, signature)
    })
  }
}
