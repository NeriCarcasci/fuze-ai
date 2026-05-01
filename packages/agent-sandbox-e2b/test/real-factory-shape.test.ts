import { describe, expect, it, vi } from 'vitest'
import {
  E2BNotInstalledError,
  RealE2BClientFactory,
  type E2BClientFactory,
} from '../src/index.js'

describe('RealE2BClientFactory', () => {
  it('can be instantiated without an API key (factory lazy-loads on create)', () => {
    expect(() => new RealE2BClientFactory()).not.toThrow()
    expect(() => new RealE2BClientFactory({})).not.toThrow()
  })

  it('matches the E2BClientFactory interface at the type level', () => {
    const factory: E2BClientFactory = new RealE2BClientFactory({ apiKey: 'test-key' })
    expect(typeof factory.create).toBe('function')
    expect(typeof factory.resume).toBe('function')
  })

  it('E2BNotInstalledError carries install instructions', () => {
    const err = new E2BNotInstalledError()
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('E2BNotInstalledError')
    expect(err.message).toMatch(/e2b/)
    expect(err.message).toMatch(/install/i)
  })

  it('create() throws E2BNotInstalledError when the e2b import fails', async () => {
    vi.resetModules()
    vi.doMock('e2b', () => {
      throw new Error("Cannot find module 'e2b'")
    })
    const mod = await import('../src/real-factory.js')
    const factory = new mod.RealE2BClientFactory({ apiKey: 'k' })
    await expect(
      factory.create({ tenant: 't', runId: 'r' }),
    ).rejects.toBeInstanceOf(mod.E2BNotInstalledError)
    vi.doUnmock('e2b')
    vi.resetModules()
  })
})
