import type { Ed25519Signer, Ed25519Verifier } from '@fuze-ai/agent'
import { CircuitBreaker, type CircuitBreakerOptions } from './circuit-breaker.js'

export interface VaultLikeClient {
  sign(keyName: string, base64Input: string): Promise<{ signature: string }>
  verify(keyName: string, base64Input: string, signature: string): Promise<{ valid: boolean }>
}

export interface VaultSignerOptions {
  vaultUrl: string
  keyName: string
  token?: string
  client?: VaultLikeClient
  circuitBreaker?: CircuitBreakerOptions
  fetchImpl?: typeof fetch
}

const SIG_PREFIX = 'vault:v1:'

function buildFetchClient(vaultUrl: string, token: string | undefined, fetchImpl: typeof fetch): VaultLikeClient {
  const base = vaultUrl.replace(/\/$/, '')
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (token) headers['x-vault-token'] = token

  return {
    async sign(keyName, input) {
      const resp = await fetchImpl(`${base}/v1/transit/sign/${encodeURIComponent(keyName)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ input }),
      })
      if (!resp.ok) throw new Error(`vault sign failed: ${resp.status}`)
      const body = (await resp.json()) as { data?: { signature?: string } }
      const sig = body.data?.signature
      if (!sig) throw new Error('vault sign returned no signature')
      return { signature: sig }
    },
    async verify(keyName, input, signature) {
      const resp = await fetchImpl(`${base}/v1/transit/verify/${encodeURIComponent(keyName)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ input, signature }),
      })
      if (!resp.ok) throw new Error(`vault verify failed: ${resp.status}`)
      const body = (await resp.json()) as { data?: { valid?: boolean } }
      return { valid: body.data?.valid === true }
    },
  }
}

function decodeVaultSig(signature: string): Uint8Array {
  const raw = signature.startsWith(SIG_PREFIX) ? signature.slice(SIG_PREFIX.length) : signature
  return new Uint8Array(Buffer.from(raw, 'base64'))
}

function encodeVaultSig(bytes: Uint8Array): string {
  return SIG_PREFIX + Buffer.from(bytes).toString('base64')
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

export class VaultSigner implements Ed25519Signer {
  readonly publicKeyId: string
  private readonly keyName: string
  private readonly client: VaultLikeClient
  private readonly breaker: CircuitBreaker

  constructor(options: VaultSignerOptions) {
    this.keyName = options.keyName
    this.publicKeyId = `${options.vaultUrl}#${options.keyName}`
    this.breaker = new CircuitBreaker(options.circuitBreaker)
    if (options.client) {
      this.client = options.client
    } else {
      const f = options.fetchImpl ?? globalThis.fetch
      if (!f) throw new Error('no fetch implementation available; pass fetchImpl or a client')
      this.client = buildFetchClient(options.vaultUrl, options.token, f)
    }
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    return this.breaker.run(async () => {
      const out = await this.client.sign(this.keyName, toBase64(message))
      return decodeVaultSig(out.signature)
    })
  }
}

export interface VaultVerifierOptions {
  vaultUrl: string
  keyName: string
  token?: string
  client?: VaultLikeClient
  circuitBreaker?: CircuitBreakerOptions
  fetchImpl?: typeof fetch
}

export class VaultVerifier implements Ed25519Verifier {
  private readonly publicKeyId: string
  private readonly keyName: string
  private readonly client: VaultLikeClient
  private readonly breaker: CircuitBreaker

  constructor(options: VaultVerifierOptions) {
    this.keyName = options.keyName
    this.publicKeyId = `${options.vaultUrl}#${options.keyName}`
    this.breaker = new CircuitBreaker(options.circuitBreaker)
    if (options.client) {
      this.client = options.client
    } else {
      const f = options.fetchImpl ?? globalThis.fetch
      if (!f) throw new Error('no fetch implementation available; pass fetchImpl or a client')
      this.client = buildFetchClient(options.vaultUrl, options.token, f)
    }
  }

  async verify(publicKeyId: string, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    if (publicKeyId !== this.publicKeyId) return false
    return this.breaker.run(async () => {
      const out = await this.client.verify(this.keyName, toBase64(message), encodeVaultSig(signature))
      return out.valid === true
    })
  }
}
