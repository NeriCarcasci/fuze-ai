import { describe, expect, it } from 'vitest'
import type { Ctx } from '@fuze-ai/agent'
import { residencyGuardrail } from '../src/residency.js'

const ctx = {} as unknown as Ctx<unknown>

describe('residencyGuardrail', () => {
  it('passes payload with allowed domain', async () => {
    const g = residencyGuardrail({ allowedDomains: ['example.eu', 'fuze.systems'] })
    const r = await g.evaluate(ctx, 'See https://docs.fuze.systems/guide for details.')
    expect(r.tripwire).toBe(false)
    expect(r.evidence['residency.violations']).toEqual([])
  })

  it('triggers on a US-only domain', async () => {
    const g = residencyGuardrail({ allowedDomains: ['example.eu'] })
    const r = await g.evaluate(ctx, 'Mirror at https://s3.us-east-1.amazonaws.com/bucket/key')
    expect(r.tripwire).toBe(true)
    const v = r.evidence['residency.violations'] as ReadonlyArray<{ url: string; reason: string }>
    expect(v).toHaveLength(1)
    expect(v[0]?.url).toContain('amazonaws.com')
  })

  it('checks every URL in the payload', async () => {
    const g = residencyGuardrail({ allowedDomains: ['example.eu'] })
    const payload = {
      links: [
        'https://example.eu/page',
        'https://evil.us/page',
        { nested: 'visit https://other.io as well' },
      ],
    }
    const r = await g.evaluate(ctx, payload)
    expect(r.tripwire).toBe(true)
    const v = r.evidence['residency.violations'] as ReadonlyArray<{ url: string; reason: string }>
    expect(v).toHaveLength(2)
    expect(v.map((x) => x.url).sort()).toEqual(['https://evil.us/page', 'https://other.io'])
  })

  it('passes payload with no URLs', async () => {
    const g = residencyGuardrail({ allowedDomains: ['example.eu'] })
    const r = await g.evaluate(ctx, { result: 'computation complete', value: 42 })
    expect(r.tripwire).toBe(false)
  })

  it('honors allowedTlds for blanket EU TLD acceptance', async () => {
    const g = residencyGuardrail({ allowedDomains: [], allowedTlds: ['eu', 'de', 'fr'] })
    const r = await g.evaluate(ctx, 'https://kunde.de/api and https://service.com/api')
    expect(r.tripwire).toBe(true)
    const v = r.evidence['residency.violations'] as ReadonlyArray<{ url: string; reason: string }>
    expect(v).toHaveLength(1)
    expect(v[0]?.url).toContain('service.com')
  })
})
