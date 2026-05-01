import { describe, it, expect } from 'vitest'
import { argsHash, outputHash } from '../src/idempotency.js'

describe('idempotency hashes', () => {
  it('argsHash is deterministic for the same args', () => {
    const a = { user: 'alice', amount: 42, items: [1, 2, 3] }
    expect(argsHash(a)).toBe(argsHash(a))
  })

  it('argsHash differs when args differ', () => {
    expect(argsHash({ x: 1 })).not.toBe(argsHash({ x: 2 }))
  })

  it('argsHash is insensitive to key order', () => {
    const ordered = { a: 1, b: 2, c: 3 }
    const reordered = { c: 3, a: 1, b: 2 }
    expect(argsHash(ordered)).toBe(argsHash(reordered))
  })

  it('argsHash distinguishes nested differences', () => {
    const a = { meta: { tags: ['x', 'y'] } }
    const b = { meta: { tags: ['x', 'z'] } }
    expect(argsHash(a)).not.toBe(argsHash(b))
  })

  it('outputHash is deterministic and key-order insensitive', () => {
    const o1 = { result: 'ok', data: { id: 1, name: 'x' } }
    const o2 = { data: { name: 'x', id: 1 }, result: 'ok' }
    expect(outputHash(o1)).toBe(outputHash(o2))
  })

  it('outputHash differs for different outputs', () => {
    expect(outputHash({ ok: true })).not.toBe(outputHash({ ok: false }))
  })

  it('hashes are 64-char hex (sha256)', () => {
    const h = argsHash({ any: 'value' })
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    expect(outputHash([1, 2, 3])).toMatch(/^[0-9a-f]{64}$/)
  })
})
