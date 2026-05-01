import { describe, it, expect } from 'vitest'
import { AzureKvSigner, AzureKvVerifier, type AzureKvLikeClient } from '../src/azure-kv.js'
import { CircuitOpenError, KmsUnavailableError } from '../src/errors.js'

function fakeClient(overrides: Partial<AzureKvLikeClient> = {}): AzureKvLikeClient {
  return {
    sign: async () => ({ result: new Uint8Array([7, 7, 7]) }),
    verify: async () => ({ result: true }),
    ...overrides,
  }
}

describe('AzureKvSigner', () => {
  it('signs through the injected client', async () => {
    const signer = new AzureKvSigner({ keyId: 'https://kv/keys/k1/v1', client: fakeClient() })
    const sig = await signer.sign(new Uint8Array([1]))
    expect(Array.from(sig)).toEqual([7, 7, 7])
  })

  it('verifies via the injected client', async () => {
    const v = new AzureKvVerifier({ keyId: 'https://kv/keys/k1/v1', client: fakeClient() })
    expect(await v.verify('https://kv/keys/k1/v1', new Uint8Array([1]), new Uint8Array([2]))).toBe(true)
    expect(await v.verify('other', new Uint8Array([1]), new Uint8Array([2]))).toBe(false)
  })

  it('opens circuit after repeated failures', async () => {
    const failing = fakeClient({ sign: async () => { throw new Error('akv down') } })
    const signer = new AzureKvSigner({
      keyId: 'k1',
      client: failing,
      circuitBreaker: { threshold: 3, openMs: 60_000 },
    })
    for (let i = 0; i < 3; i++) {
      await expect(signer.sign(new Uint8Array([1]))).rejects.toThrow('akv down')
    }
    await expect(signer.sign(new Uint8Array([1]))).rejects.toBeInstanceOf(CircuitOpenError)
  })

  it('throws KmsUnavailableError when SDK is missing', async () => {
    const signer = new AzureKvSigner({ keyId: 'https://nope.vault.azure.net/keys/k/v' })
    await expect(signer.sign(new Uint8Array([1]))).rejects.toBeInstanceOf(KmsUnavailableError)
  })
})
