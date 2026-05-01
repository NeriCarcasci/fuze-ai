import { describe, it, expect, vi } from 'vitest'
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto'
import { GcpKmsSigner, GcpKmsVerifier, type GcpKmsLikeClient } from '../src/gcp-kms.js'
import { CircuitOpenError, KmsUnavailableError } from '../src/errors.js'

vi.mock('@google-cloud/kms', () => {
  throw new Error('module not installed')
})

describe('GcpKmsSigner', () => {
  it('signs and verifies through the fake client', async () => {
    const { privateKey, publicKey } = generateKeyPairSync('ed25519')
    const pem = publicKey.export({ type: 'spki', format: 'pem' }) as string
    const client: GcpKmsLikeClient = {
      asymmetricSign: async (req) => {
        const sig = cryptoSign(null, req.data, privateKey)
        return [{ signature: new Uint8Array(sig.buffer, sig.byteOffset, sig.byteLength) }]
      },
      getPublicKey: async () => [{ pem }],
    }
    const signer = new GcpKmsSigner({ keyName: 'projects/x/keys/k', client })
    const verifier = new GcpKmsVerifier({ keyName: 'projects/x/keys/k', client })
    const msg = new Uint8Array([1, 2, 3, 4])
    const sig = await signer.sign(msg)
    const ok = await verifier.verify('projects/x/keys/k', msg, sig)
    expect(ok).toBe(true)
  })

  it('verifier rejects mismatched key id without calling upstream', async () => {
    let calls = 0
    const client: GcpKmsLikeClient = {
      asymmetricSign: async () => [{ signature: new Uint8Array() }],
      getPublicKey: async () => { calls += 1; return [{ pem: '' }] },
    }
    const verifier = new GcpKmsVerifier({ keyName: 'k1', client })
    const ok = await verifier.verify('other', new Uint8Array(), new Uint8Array())
    expect(ok).toBe(false)
    expect(calls).toBe(0)
  })

  it('opens circuit on repeated failures', async () => {
    const client: GcpKmsLikeClient = {
      asymmetricSign: async () => { throw new Error('gcp down') },
      getPublicKey: async () => [{ pem: '' }],
    }
    const signer = new GcpKmsSigner({
      keyName: 'k1',
      client,
      circuitBreaker: { threshold: 3, openMs: 60_000 },
    })
    for (let i = 0; i < 3; i++) {
      await expect(signer.sign(new Uint8Array([1]))).rejects.toThrow('gcp down')
    }
    await expect(signer.sign(new Uint8Array([1]))).rejects.toBeInstanceOf(CircuitOpenError)
  })

  it('throws KmsUnavailableError when SDK is missing', async () => {
    const signer = new GcpKmsSigner({ keyName: 'k1' })
    await expect(signer.sign(new Uint8Array([1]))).rejects.toBeInstanceOf(KmsUnavailableError)
  })
})
