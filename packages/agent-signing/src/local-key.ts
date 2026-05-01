import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type KeyObject,
} from 'node:crypto'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Ed25519Signer, Ed25519Verifier } from '@fuze-ai/agent'

export interface LocalKeySignerOptions {
  keyPath?: string
}

interface LoadedKey {
  privateKey: KeyObject
  publicKeyPem: string
  publicKeyId: string
}

function defaultKeyPath(): string {
  return path.join(os.homedir(), '.fuze', 'agent-key')
}

function deriveKeyId(publicKeyPem: string): string {
  return createHash('sha256').update(publicKeyPem).digest('hex').slice(0, 16)
}

function loadOrCreate(keyPath: string): LoadedKey {
  const pubPath = `${keyPath}.pub`
  const keyDir = path.dirname(keyPath)
  mkdirSync(keyDir, { recursive: true })

  if (!existsSync(keyPath)) {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' })
    const publicPem = publicKey.export({ type: 'spki', format: 'pem' })
    writeFileSync(keyPath, privatePem)
    writeFileSync(pubPath, publicPem)
    chmodSync(keyPath, 0o600)
    const publicPemStr = typeof publicPem === 'string' ? publicPem : publicPem.toString('utf8')
    return {
      privateKey,
      publicKeyPem: publicPemStr,
      publicKeyId: deriveKeyId(publicPemStr),
    }
  }

  chmodSync(keyPath, 0o600)
  const privatePem = readFileSync(keyPath, 'utf8')
  const privateKey = createPrivateKey(privatePem)

  let publicKeyPem: string
  if (existsSync(pubPath)) {
    publicKeyPem = readFileSync(pubPath, 'utf8')
  } else {
    const publicKey = createPublicKey(privateKey)
    const exported = publicKey.export({ type: 'spki', format: 'pem' })
    publicKeyPem = typeof exported === 'string' ? exported : exported.toString('utf8')
    writeFileSync(pubPath, publicKeyPem)
  }

  return {
    privateKey,
    publicKeyPem,
    publicKeyId: deriveKeyId(publicKeyPem),
  }
}

export class LocalKeySigner implements Ed25519Signer {
  readonly publicKeyId: string
  readonly publicKeyPem: string
  readonly keyPath: string
  private readonly privateKey: KeyObject

  constructor(options: LocalKeySignerOptions = {}) {
    this.keyPath = options.keyPath ?? defaultKeyPath()
    const loaded = loadOrCreate(this.keyPath)
    this.privateKey = loaded.privateKey
    this.publicKeyPem = loaded.publicKeyPem
    this.publicKeyId = loaded.publicKeyId
  }

  async sign(message: Uint8Array): Promise<Uint8Array> {
    const sig = cryptoSign(null, message, this.privateKey)
    return new Uint8Array(sig.buffer, sig.byteOffset, sig.byteLength)
  }
}

export class LocalKeyVerifier implements Ed25519Verifier {
  private readonly keys: Map<string, KeyObject>

  constructor(publicKeysPem: Map<string, string>) {
    this.keys = new Map()
    for (const [keyId, pem] of publicKeysPem) {
      this.keys.set(keyId, createPublicKey(pem))
    }
  }

  static fromSigner(signer: LocalKeySigner): LocalKeyVerifier {
    const map = new Map<string, string>()
    map.set(signer.publicKeyId, signer.publicKeyPem)
    return new LocalKeyVerifier(map)
  }

  async verify(publicKeyId: string, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
    const key = this.keys.get(publicKeyId)
    if (!key) return false
    return cryptoVerify(null, message, key, signature)
  }
}
