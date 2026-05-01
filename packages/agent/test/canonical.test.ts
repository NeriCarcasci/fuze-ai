import { describe, expect, it } from 'vitest'
import { canonicalize } from '../src/evidence/canonical.js'

describe('canonicalize', () => {
  it('sorts object keys deterministically', () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
    expect(canonicalize({ a: 2, b: 1 })).toBe('{"a":2,"b":1}')
  })

  it('escapes control characters', () => {
    expect(canonicalize('a\nb')).toBe('"a\\nb"')
    expect(canonicalize('ab')).toBe('"a\\u0001b"')
    expect(canonicalize('')).toBe('""')
  })

  it('handles nested arrays and objects', () => {
    const v = { z: [3, { y: 1, x: 2 }], a: null }
    expect(canonicalize(v)).toBe('{"a":null,"z":[3,{"x":2,"y":1}]}')
  })

  it('drops undefined keys', () => {
    expect(canonicalize({ a: 1, b: undefined })).toBe('{"a":1}')
  })

  it('refuses non-finite numbers', () => {
    expect(() => canonicalize(Number.NaN)).toThrow()
    expect(() => canonicalize(Number.POSITIVE_INFINITY)).toThrow()
  })

  it('produces identical output for permuted keys', () => {
    const a = canonicalize({ z: 1, m: 2, a: 3, beta: { y: 9, x: 8 } })
    const b = canonicalize({ a: 3, beta: { x: 8, y: 9 }, m: 2, z: 1 })
    expect(a).toBe(b)
  })
})
