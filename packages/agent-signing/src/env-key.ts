import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto'
import { SignerUnavailableError, type Ed25519Signer, type Ed25519Verifier } from '@fuze-ai/agent'

const PRIVATE_ENV = 'FUZE_AGENT_PRIVATE_KEY_PEM'
const PUBLIC_ENV = 'FUZE_AGENT_PUBLIC_KEY_PEM'

export interface EnvKeySignerOptions {
  env?: NodeJS.ProcessEnv
}

function deriveKeyId(publicKeyPem: string): string {
  return createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 16)
}

export class EnvKeySigner implements Ed25519Signer {
  readonly publicKeyId: string
  readonly publicKeyPem: string
  private readonly privateKey: KeyObject

  constructor(options: EnvKeySignerOptions = {}) {
    const env = options.env ?? process.env
    const privatePem = env[PRIVATE_ENV]
    const publicPem = env[PUBLIC_ENV]
    if (!privatePem) {
      throw new SignerUnavailableError(`${PRIVATE_ENV} is not set`)
    }
    if (!publicPem) {
      throw new SignerUnavailableError(`${PUBLIC_ENV} is not set`)
    }
    this.privateKey = createPrivateKey(privatePem)
    this.publicKeyPem = publicPem
    this.publicKeyId = deriveKeyId(publicPem)
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    const sig = cryptoSign(null, message, this.privateKey)
    return new Uint8Array(sig.buffer, sig.byteOffset, sig.byteLength)
  }
}

export class EnvKeyVerifier implements Ed25519Verifier {
  private readonly keys: Map<string, KeyObject>

  constructor(publicKeysPem: Map<string, string>) {
    this.keys = new Map()
    for (const [keyId, pem] of publicKeysPem) {
      this.keys.set(keyId, createPublicKey(pem))
    }
  }

  static fromSigner(signer: EnvKeySigner): EnvKeyVerifier {
    const map = new Map<string, string>()
    map.set(signer.publicKeyId, signer.publicKeyPem)
    return new EnvKeyVerifier(map)
  }

  async verify(publicKeyId: string, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    const key = this.keys.get(publicKeyId)
    if (!key) return false
    return cryptoVerify(null, message, key, signature)
  }
}
