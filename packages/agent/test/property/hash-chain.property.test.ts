import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { HashChain, verifyChain } from '../../src/evidence/hash-chain.js'

const arbitraryPayload = fc.record({
  span: fc.string({ minLength: 1, maxLength: 32 }),
  seq: fc.integer({ min: 0, max: 1000 }),
  attrs: fc.dictionary(fc.string({ minLength: 1, maxLength: 16 }), fc.oneof(fc.string(), fc.integer(), fc.boolean())),
})

describe('HashChain property tests', () => {
  it('verifyChain returns true for any sequence emitted by HashChain.append', () => {
    fc.assert(
      fc.property(fc.array(arbitraryPayload, { minLength: 0, maxLength: 50 }), (payloads) => {
        const chain = new HashChain<typeof payloads[number]>()
        const records = payloads.map((p) => chain.append(p))
        expect(verifyChain(records)).toBe(true)
      }),
      { numRuns: 200 },
    )
  })

  it('verifyChain detects any single-byte payload tamper', () => {
    fc.assert(
      fc.property(
        fc.array(arbitraryPayload, { minLength: 1, maxLength: 30 }),
        fc.nat(),
        (payloads, indexSeed) => {
          const chain = new HashChain<typeof payloads[number]>()
          const records = payloads.map((p) => chain.append(p))
          const idx = indexSeed % records.length
          const target = records[idx]
          if (!target) return true
          const tampered = [...records]
          tampered[idx] = { ...target, payload: { ...target.payload, span: target.payload.span + 'x' } }
          return verifyChain(tampered) === false
        },
      ),
      { numRuns: 100 },
    )
  })

  it('head is deterministic given the same payload sequence', () => {
    fc.assert(
      fc.property(fc.array(arbitraryPayload, { minLength: 1, maxLength: 30 }), (payloads) => {
        const a = new HashChain<typeof payloads[number]>()
        const b = new HashChain<typeof payloads[number]>()
        for (const p of payloads) a.append(p)
        for (const p of payloads) b.append(p)
        expect(a.head()).toBe(b.head())
      }),
      { numRuns: 100 },
    )
  })

  it('resume with valid prevHash and sequence preserves verifiability', () => {
    fc.assert(
      fc.property(
        fc.array(arbitraryPayload, { minLength: 1, maxLength: 20 }),
        fc.array(arbitraryPayload, { minLength: 0, maxLength: 20 }),
        (first, second) => {
          const c1 = new HashChain<typeof first[number]>()
          const r1 = first.map((p) => c1.append(p))
          const c2 = new HashChain<typeof first[number]>()
          c2.resume(c1.head(), r1.length)
          const r2 = second.map((p) => c2.append(p))
          const combined = [...r1, ...r2]
          return verifyChain(combined)
        },
      ),
      { numRuns: 100 },
    )
  })
})
