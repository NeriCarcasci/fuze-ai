import { describe, expect, it } from 'vitest'
import { listModules, getModule, isEuRegion } from '../src/inventory.js'

describe('inventory', () => {
  it('lists all four modules', () => {
    const mods = listModules()
    expect(mods.map((m) => m.cloud).sort()).toEqual(['aws', 'hetzner', 'ovh', 'scaleway'])
  })

  it('each module has a non-empty EU-residency claim', () => {
    for (const m of listModules()) {
      expect(m.euResidencyClaim.length).toBeGreaterThan(20)
      expect(m.modulePath).toMatch(/^modules\//)
    }
  })

  it('regions are non-empty and isEuRegion agrees with them', () => {
    for (const m of listModules()) {
      expect(m.supportedRegions.length).toBeGreaterThan(0)
      const first = m.supportedRegions[0]
      expect(first).toBeDefined()
      if (first !== undefined) {
        expect(isEuRegion(m.cloud, first)).toBe(true)
      }
    }
    expect(isEuRegion('aws', 'us-east-1')).toBe(false)
    expect(() => getModule('hetzner')).not.toThrow()
  })
})
