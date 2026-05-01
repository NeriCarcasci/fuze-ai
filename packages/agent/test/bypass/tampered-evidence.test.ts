import { describe, expect, it } from 'vitest'
import { HashChain, verifyChain } from '../../src/evidence/hash-chain.js'

describe('bypass: tampered evidence', () => {
  it('detects a single-byte tamper in payload', () => {
    const chain = new HashChain<{ msg: string }>()
    const r1 = chain.append({ msg: 'a' })
    const r2 = chain.append({ msg: 'b' })
    const r3 = chain.append({ msg: 'c' })
    const tampered = [r1, { ...r2, payload: { msg: 'B' } }, r3]
    expect(verifyChain(tampered)).toBe(false)
  })

  it('detects swapped records', () => {
    const chain = new HashChain<{ n: number }>()
    const r1 = chain.append({ n: 1 })
    const r2 = chain.append({ n: 2 })
    const r3 = chain.append({ n: 3 })
    expect(verifyChain([r1, r3, r2])).toBe(false)
  })

  it('detects forged hash', () => {
    const chain = new HashChain<{ x: number }>()
    const r1 = chain.append({ x: 1 })
    const r2 = chain.append({ x: 2 })
    const forged = { ...r2, hash: 'f'.repeat(64) }
    expect(verifyChain([r1, forged])).toBe(false)
  })

  it('rejects a chain with a missing prevHash linkage', () => {
    const chain = new HashChain<{ x: number }>()
    const r1 = chain.append({ x: 1 })
    const r2 = chain.append({ x: 2 })
    const broken = { ...r2, prevHash: '0'.repeat(64) }
    expect(verifyChain([r1, broken])).toBe(false)
  })
})
