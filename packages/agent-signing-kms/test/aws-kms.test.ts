import { describe, it, expect, vi } from 'vitest'
import { AwsKmsSigner, AwsKmsVerifier, type AwsKmsLikeClient } from '../src/aws-kms.js'
import { CircuitOpenError, KmsUnavailableError } from '../src/errors.js'

vi.mock('@aws-sdk/client-kms', () => {
  throw new Error('module not installed')
})

function fakeClient(overrides: Partial<AwsKmsLikeClient> = {}): AwsKmsLikeClient {
  return {
    sign: async () => ({ Signature: new Uint8Array([1, 2, 3]) }),
    verify: async () => ({ SignatureValid: true }),
    ...overrides,
  }
}

describe('AwsKmsSigner', () => {
  it('signs with the injected client', async () => {
    const signer = new AwsKmsSigner({ keyId: 'k1', region: 'eu-west-1', client: fakeClient() })
    const sig = await signer.sign(new Uint8Array([9, 9]))
    expect(Array.from(sig)).toEqual([1, 2, 3])
    expect(signer.publicKeyId).toBe('k1')
  })

  it('verifies via the injected client', async () => {
    const verifier = new AwsKmsVerifier({ keyId: 'k1', region: 'eu-west-1', client: fakeClient() })
    const ok = await verifier.verify('k1', new Uint8Array([1]), new Uint8Array([2]))
    expect(ok).toBe(true)
    const wrongKey = await verifier.verify('other', new Uint8Array([1]), new Uint8Array([2]))
    expect(wrongKey).toBe(false)
  })

  it('opens circuit after 3 consecutive failures', async () => {
    const failing = fakeClient({ sign: async () => { throw new Error('kms down') } })
    const signer = new AwsKmsSigner({
      keyId: 'k1',
      region: 'eu-west-1',
      client: failing,
      circuitBreaker: { threshold: 3, openMs: 60_000 },
    })
    for (let i = 0; i < 3; i++) {
      await expect(signer.sign(new Uint8Array([1]))).rejects.toThrow('kms down')
    }
    await expect(signer.sign(new Uint8Array([1]))).rejects.toBeInstanceOf(CircuitOpenError)
  })

  it('refuses to call upstream while circuit is open', async () => {
    let calls = 0
    const failing: AwsKmsLikeClient = {
      sign: async () => { calls += 1; throw new Error('x') },
      verify: async () => ({ SignatureValid: false }),
    }
    const signer = new AwsKmsSigner({
      keyId: 'k1',
      region: 'eu-west-1',
      client: failing,
      circuitBreaker: { threshold: 2, openMs: 60_000 },
    })
    await expect(signer.sign(new Uint8Array([1]))).rejects.toThrow('x')
    await expect(signer.sign(new Uint8Array([1]))).rejects.toThrow('x')
    await expect(signer.sign(new Uint8Array([1]))).rejects.toBeInstanceOf(CircuitOpenError)
    expect(calls).toBe(2)
  })

  it('throws KmsUnavailableError when SDK is missing', async () => {
    const signer = new AwsKmsSigner({ keyId: 'k1', region: 'eu-west-1' })
    await expect(signer.sign(new Uint8Array([1]))).rejects.toBeInstanceOf(KmsUnavailableError)
  })
})
