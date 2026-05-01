import { describe, expect, it } from 'vitest'
import type { Ctx } from '@fuze-ai/agent'
import { piiGuardrail } from '../src/pii.js'

const ctx = {} as unknown as Ctx<unknown>

describe('piiGuardrail', () => {
  it('passes a clean string', async () => {
    const g = piiGuardrail()
    const r = await g.evaluate(ctx, 'The quick brown fox jumps over the lazy dog.')
    expect(r.tripwire).toBe(false)
    expect(r.evidence['pii.matches']).toEqual([])
  })

  it('triggers on email', async () => {
    const g = piiGuardrail()
    const r = await g.evaluate(ctx, 'contact me at jane.doe@example.com please')
    expect(r.tripwire).toBe(true)
    const matches = r.evidence['pii.matches'] as ReadonlyArray<{ kind: string; count: number }>
    expect(matches).toContainEqual({ kind: 'email', count: 1 })
  })

  it('triggers on E.164 phone', async () => {
    const g = piiGuardrail()
    const r = await g.evaluate(ctx, 'call +33612345678 or +14155552671')
    expect(r.tripwire).toBe(true)
    const matches = r.evidence['pii.matches'] as ReadonlyArray<{ kind: string; count: number }>
    const phone = matches.find((m) => m.kind === 'phone')
    expect(phone?.count).toBe(2)
  })

  it('does NOT trigger on credit card with bad Luhn', async () => {
    const g = piiGuardrail({ kinds: ['creditCard'] })
    const r = await g.evaluate(ctx, 'card: 4111 1111 1111 1112')
    expect(r.tripwire).toBe(false)
  })

  it('triggers on valid IBAN', async () => {
    const g = piiGuardrail({ kinds: ['iban'] })
    const r = await g.evaluate(ctx, 'IBAN GB82WEST12345698765432 transfer')
    expect(r.tripwire).toBe(true)
    const matches = r.evidence['pii.matches'] as ReadonlyArray<{ kind: string; count: number }>
    expect(matches).toContainEqual({ kind: 'iban', count: 1 })
  })

  it('evidence carries counts only, never raw values', async () => {
    const g = piiGuardrail()
    const raw = 'email me jane.doe@example.com or call +33612345678'
    const r = await g.evaluate(ctx, raw)
    const blob = JSON.stringify(r.evidence)
    expect(blob).not.toContain('jane.doe@example.com')
    expect(blob).not.toContain('+33612345678')
  })

  it('triggers on valid credit card with Luhn pass', async () => {
    const g = piiGuardrail({ kinds: ['creditCard'] })
    const r = await g.evaluate(ctx, 'card 4111-1111-1111-1111 expires soon')
    expect(r.tripwire).toBe(true)
  })
})
