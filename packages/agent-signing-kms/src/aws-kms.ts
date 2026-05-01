import type { Ed25519Signer, Ed25519Verifier } from '@fuze-ai/agent'
import { CircuitBreaker, type CircuitBreakerOptions } from './circuit-breaker.js'
import { KmsUnavailableError } from './errors.js'

export interface AwsKmsSignInput {
  KeyId: string
  Message: Uint8Array
  MessageType: 'RAW'
  SigningAlgorithm: 'ECDSA_SHA_256' | 'EDDSA'
}

export interface AwsKmsSignOutput {
  Signature?: Uint8Array
  KeyId?: string
}

export interface AwsKmsVerifyInput {
  KeyId: string
  Message: Uint8Array
  Signature: Uint8Array
  MessageType: 'RAW'
  SigningAlgorithm: 'ECDSA_SHA_256' | 'EDDSA'
}

export interface AwsKmsVerifyOutput {
  SignatureValid?: boolean
}

export interface AwsKmsLikeClient {
  sign(input: AwsKmsSignInput): Promise<AwsKmsSignOutput>
  verify(input: AwsKmsVerifyInput): Promise<AwsKmsVerifyOutput>
}

export interface AwsKmsSignerOptions {
  keyId: string
  region: string
  client?: AwsKmsLikeClient
  circuitBreaker?: CircuitBreakerOptions
}

async function loadAwsClient(region: string): Promise<AwsKmsLikeClient> {
  let mod: { KMSClient: new (cfg: { region: string }) => unknown; SignCommand: new (i: AwsKmsSignInput) => unknown; VerifyCommand: new (i: AwsKmsVerifyInput) => unknown }
  try {
    mod = (await import('@aws-sdk/client-kms')) as unknown as typeof mod
  } catch {
    throw new KmsUnavailableError(
      'optional dependency @aws-sdk/client-kms is not installed; run `npm i @aws-sdk/client-kms` or pass a client'
    )
  }
  const inner = new mod.KMSClient({ region }) as { send: (cmd: unknown) => Promise<unknown> }
  return {
    sign: async (i) => (await inner.send(new mod.SignCommand(i))) as AwsKmsSignOutput,
    verify: async (i) => (await inner.send(new mod.VerifyCommand(i))) as AwsKmsVerifyOutput,
  }
}

export class AwsKmsSigner implements Ed25519Signer {
  readonly publicKeyId: string
  private readonly keyId: string
  private readonly region: string
  private readonly breaker: CircuitBreaker
  private clientPromise: Promise<AwsKmsLikeClient> | null

  constructor(options: AwsKmsSignerOptions) {
    this.keyId = options.keyId
    this.region = options.region
    this.publicKeyId = options.keyId
    this.breaker = new CircuitBreaker(options.circuitBreaker)
    this.clientPromise = options.client ? Promise.resolve(options.client) : null
  }

  private async client(): Promise<AwsKmsLikeClient> {
    if (!this.clientPromise) {
      this.clientPromise = loadAwsClient(this.region)
    }
    return this.clientPromise
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    return this.breaker.run(async () => {
      const c = await this.client()
      const out = await c.sign({
        KeyId: this.keyId,
        Message: message,
        MessageType: 'RAW',
        SigningAlgorithm: 'EDDSA',
      })
      if (!out.Signature) throw new Error('AWS KMS sign returned no signature')
      return out.Signature
    })
  }
}

export interface AwsKmsVerifierOptions {
  keyId: string
  region: string
  client?: AwsKmsLikeClient
  circuitBreaker?: CircuitBreakerOptions
}

export class AwsKmsVerifier implements Ed25519Verifier {
  private readonly keyId: string
  private readonly region: string
  private readonly breaker: CircuitBreaker
  private clientPromise: Promise<AwsKmsLikeClient> | null

  constructor(options: AwsKmsVerifierOptions) {
    this.keyId = options.keyId
    this.region = options.region
    this.breaker = new CircuitBreaker(options.circuitBreaker)
    this.clientPromise = options.client ? Promise.resolve(options.client) : null
  }

  private async client(): Promise<AwsKmsLikeClient> {
    if (!this.clientPromise) {
      this.clientPromise = loadAwsClient(this.region)
    }
    return this.clientPromise
  }

  async verify(publicKeyId: string, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    if (publicKeyId !== this.keyId) return false
    return this.breaker.run(async () => {
      const c = await this.client()
      const out = await c.verify({
        KeyId: this.keyId,
        Message: message,
        Signature: signature,
        MessageType: 'RAW',
        SigningAlgorithm: 'EDDSA',
      })
      return out.SignatureValid === true
    })
  }
}
