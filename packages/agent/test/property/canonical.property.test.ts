import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { canonicalize } from '../../src/evidence/canonical.js'

const jsonValue: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  any: fc.oneof(
    { withCrossShrink: true },
    fc.constant(null),
    fc.boolean(),
    fc.integer({ min: -1_000_000, max: 1_000_000 }),
    fc.string({ maxLength: 32 }),
    fc.array(tie('any'), { maxLength: 5 }),
    fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), tie('any'), { maxKeys: 5 }),
  ),
})).any

describe('canonicalize property tests', () => {
  it('is deterministic across runs', () => {
    fc.assert(
      fc.property(jsonValue, (v) => canonicalize(v) === canonicalize(v)),
      { numRuns: 200 },
    )
  })

  it('object key permutation does not change output', () => {
    fc.assert(
      fc.property(
        fc.dictionary(fc.string({ minLength: 1, maxLength: 8 }), jsonValue, { maxKeys: 8 }),
        (obj) => {
          const keys = Object.keys(obj)
          const shuffled: Record<string, unknown> = {}
          for (const k of [...keys].reverse()) shuffled[k] = obj[k]
          return canonicalize(obj) === canonicalize(shuffled)
        },
      ),
      { numRuns: 200 },
    )
  })

  it('output parses back to a value that round-trips through canonicalize', () => {
    fc.assert(
      fc.property(jsonValue, (v) => {
        const c1 = canonicalize(v)
        const reparsed: unknown = JSON.parse(c1)
        const c2 = canonicalize(reparsed)
        return c1 === c2
      }),
      { numRuns: 200 },
    )
  })
})
