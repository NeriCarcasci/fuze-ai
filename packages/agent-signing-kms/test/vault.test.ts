import { describe, it, expect } from 'vitest'
import { VaultSigner, VaultVerifier, type VaultLikeClient } from '../src/vault.js'
import { CircuitOpenError } from '../src/errors.js'

function fakeClient(overrides: Partial<VaultLikeClient> = {}): VaultLikeClient {
  return {
    sign: async () => ({ signature: 'vault:v1:' + Buffer.from([5, 5, 5]).toString('base64') }),
    verify: async () => ({ valid: true }),
    ...overrides,
  }
}

describe('VaultSigner', () => {
  it('decodes the vault signature envelope', async () => {
    const signer = new VaultSigner({ vaultUrl: 'https://v', keyName: 'k', client: fakeClient() })
    const sig = await signer.sign(new Uint8Array([1]))
    expect(Array.from(sig)).toEqual([5, 5, 5])
    expect(signer.publicKeyId).toBe('https://v#k')
  })

  it('verifies via the injected client', async () => {
    const v = new VaultVerifier({ vaultUrl: 'https://v', keyName: 'k', client: fakeClient() })
    const ok = await v.verify('https://v#k', new Uint8Array([1]), new Uint8Array([5, 5, 5]))
    expect(ok).toBe(true)
    const wrong = await v.verify('other#k', new Uint8Array([1]), new Uint8Array([5]))
    expect(wrong).toBe(false)
  })

  it('opens circuit after repeated failures', async () => {
    const failing = fakeClient({ sign: async () => { throw new Error('vault down') } })
    const signer = new VaultSigner({
      vaultUrl: 'https://v',
      keyName: 'k',
      client: failing,
      circuitBreaker: { threshold: 3, openMs: 60_000 },
    })
    for (let i = 0; i < 3; i++) {
      await expect(signer.sign(new Uint8Array([1]))).rejects.toThrow('vault down')
    }
    await expect(signer.sign(new Uint8Array([1]))).rejects.toBeInstanceOf(CircuitOpenError)
  })

  it('uses fetchImpl when no client given', async () => {
    const calls: string[] = []
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(String(url))
      const body = JSON.parse(String(init?.body)) as { input: string }
      expect(body.input).toBe(Buffer.from([1, 2]).toString('base64'))
      return new Response(JSON.stringify({ data: { signature: 'vault:v1:' + Buffer.from([9]).toString('base64') } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }) as unknown as typeof fetch
    const signer = new VaultSigner({
      vaultUrl: 'https://v/',
      keyName: 'k',
      token: 't',
      fetchImpl,
    })
    const sig = await signer.sign(new Uint8Array([1, 2]))
    expect(Array.from(sig)).toEqual([9])
    expect(calls[0]).toBe('https://v/v1/transit/sign/k')
  })
})
