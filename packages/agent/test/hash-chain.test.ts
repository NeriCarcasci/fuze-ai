import { describe, expect, it } from 'vitest'
import { HashChain, verifyChain } from '../src/evidence/hash-chain.js'

describe('HashChain', () => {
  it('chains records by previous hash', () => {
    const chain = new HashChain<{ msg: string }>()
    const r1 = chain.append({ msg: 'a' })
    const r2 = chain.append({ msg: 'b' })
    expect(r1.prevHash).toBe('0'.repeat(64))
    expect(r2.prevHash).toBe(r1.hash)
    expect(r1.sequence).toBe(0)
    expect(r2.sequence).toBe(1)
  })

  it('verifies a valid chain', () => {
    const chain = new HashChain<{ n: number }>()
    const records = [chain.append({ n: 1 }), chain.append({ n: 2 }), chain.append({ n: 3 })]
    expect(verifyChain(records)).toBe(true)
  })

  it('detects tampered payload', () => {
    const chain = new HashChain<{ n: number }>()
    const r1 = chain.append({ n: 1 })
    const r2 = chain.append({ n: 2 })
    const tampered = [r1, { ...r2, payload: { n: 99 } }]
    expect(verifyChain(tampered)).toBe(false)
  })

  it('detects rearranged sequence', () => {
    const chain = new HashChain<{ n: number }>()
    const r1 = chain.append({ n: 1 })
    const r2 = chain.append({ n: 2 })
    expect(verifyChain([r2, r1])).toBe(false)
  })

  it('produces stable head', () => {
    const c1 = new HashChain<{ x: number }>()
    c1.append({ x: 1 })
    c1.append({ x: 2 })
    const c2 = new HashChain<{ x: number }>()
    c2.append({ x: 1 })
    c2.append({ x: 2 })
    expect(c1.head()).toBe(c2.head())
  })
})
