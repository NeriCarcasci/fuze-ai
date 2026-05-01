import { describe, expect, it, vi } from 'vitest'
import {
  JustBashNotInstalledError,
  RealBashFactory,
  type BashFactory,
} from '../src/index.js'

describe('RealBashFactory', () => {
  it('can be instantiated without throwing (lazy loading)', () => {
    expect(() => new RealBashFactory()).not.toThrow()
  })

  it('matches the BashFactory interface at the type level', () => {
    const factory: BashFactory = new RealBashFactory()
    expect(typeof factory.create).toBe('function')
  })

  it('JustBashNotInstalledError carries install instructions', () => {
    const err = new JustBashNotInstalledError()
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('JustBashNotInstalledError')
    expect(err.message).toMatch(/just-bash/)
    expect(err.message).toMatch(/install/i)
  })

  it('throws JustBashNotInstalledError when the require call fails', async () => {
    vi.resetModules()
    vi.doMock('node:module', () => ({
      createRequire: () => () => {
        throw new Error("Cannot find module 'just-bash'")
      },
    }))
    const mod = await import('../src/real-factory.js')
    const factory = new mod.RealBashFactory()
    expect(() => factory.create({})).toThrow(mod.JustBashNotInstalledError)
    vi.doUnmock('node:module')
    vi.resetModules()
  })
})
