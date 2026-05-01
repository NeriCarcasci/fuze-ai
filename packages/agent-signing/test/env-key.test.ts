import { describe, it, expect } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { EnvKeySigner, EnvKeyVerifier } from '../src/env-key.js'

function makeKeyPair(): { privatePem: string; publicPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const priv = privateKey.export({ type: 'pkcs8', format: 'pem' })
  const pub = publicKey.export({ type: 'spki', format: 'pem' })
  return {
    privatePem: typeof priv === 'string' ? priv : priv.toString('utf8'),
    publicPem: typeof pub === 'string' ? pub : pub.toString('utf8'),
  }
}

describe('EnvKeySigner', () => {
  it('throws when the private-key env var is missing', () => {
    const { publicPem } = makeKeyPair()
    const env = { FUZE_AGENT_PUBLIC_KEY_PEM: publicPem }
    expect(() => new EnvKeySigner({ env })).toThrow(/FUZE_AGENT_PRIVATE_KEY_PEM/)
  })

  it('throws when the public-key env var is missing', () => {
    const { privatePem } = makeKeyPair()
    const env = { FUZE_AGENT_PRIVATE_KEY_PEM: privatePem }
    expect(() => new EnvKeySigner({ env })).toThrow(/FUZE_AGENT_PUBLIC_KEY_PEM/)
  })

  it('signs and verifies a message round-trip', async () => {
    const { privatePem, publicPem } = makeKeyPair()
    const env = {
      FUZE_AGENT_PRIVATE_KEY_PEM: privatePem,
      FUZE_AGENT_PUBLIC_KEY_PEM: publicPem,
    }
    const signer = new EnvKeySigner({ env })
    const verifier = EnvKeyVerifier.fromSigner(signer)
    const message = new TextEncoder().encode('payload')
    const sig = await signer.sign(message)
    const ok = await verifier.verify(signer.publicKeyId, message, sig)
    expect(ok).toBe(true)
  })

  it('produces deterministic signatures for the same input', async () => {
    const { privatePem, publicPem } = makeKeyPair()
    const env = {
      FUZE_AGENT_PRIVATE_KEY_PEM: privatePem,
      FUZE_AGENT_PUBLIC_KEY_PEM: publicPem,
    }
    const signer = new EnvKeySigner({ env })
    const message = new TextEncoder().encode('same input')
    const a = await signer.sign(message)
    const b = await signer.sign(message)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
  })
})
