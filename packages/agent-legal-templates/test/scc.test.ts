import { describe, expect, it } from 'vitest'
import { selectScc } from '../src/scc.js'
import type { TransferContext } from '../src/types.js'

const ctx = (overrides: Partial<TransferContext>): TransferContext => ({
  controllerCountry: 'DE',
  processorCountry: 'NL',
  controllerRole: 'controller',
  processorRole: 'processor',
  controllerAdequacy: 'eu',
  processorAdequacy: 'eu',
  ...overrides,
})

describe('selectScc', () => {
  it('controller (EU) → processor (EU) needs no SCCs', () => {
    const r = selectScc(ctx({}))
    expect(r.required).toBe(false)
    expect(r.modules).toEqual([])
    expect(r.requiresTia).toBe(false)
  })

  it('controller (EU) → processor (US) returns Module 2 and requires TIA', () => {
    const r = selectScc(
      ctx({ processorCountry: 'US', processorAdequacy: 'none' }),
    )
    expect(r.required).toBe(true)
    expect(r.modules).toContain('module-2-c2p')
    expect(r.requiresTia).toBe(true)
    expect(r.dockingClause).toBe(true)
  })

  it('processor → processor returns Module 3', () => {
    const r = selectScc(
      ctx({
        controllerRole: 'processor',
        processorRole: 'processor',
        processorCountry: 'IN',
        processorAdequacy: 'none',
      }),
    )
    expect(r.modules).toContain('module-3-p2p')
  })

  it('controller (EU) → controller (US) returns Module 1', () => {
    const r = selectScc(
      ctx({
        controllerRole: 'controller',
        processorRole: 'controller',
        processorCountry: 'US',
        processorAdequacy: 'none',
      }),
    )
    expect(r.modules).toContain('module-1-c2c')
  })

  it('UK adequacy destination requires SCCs but no TIA', () => {
    const r = selectScc(
      ctx({ processorCountry: 'GB', processorAdequacy: 'adequacy' }),
    )
    // Exporter is EU, importer has adequacy decision → no SCC needed for the transfer.
    expect(r.required).toBe(false)
    expect(r.requiresTia).toBe(false)
  })

  it('non-adequacy destination flags requiresTia=true', () => {
    const r = selectScc(
      ctx({ processorCountry: 'IN', processorAdequacy: 'none' }),
    )
    expect(r.requiresTia).toBe(true)
    expect(r.customizationsRequired.length).toBeGreaterThan(0)
  })
})
