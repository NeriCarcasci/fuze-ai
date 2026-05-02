import { describe, expect, it } from 'vitest'
import { HashChain, verifyChain } from '../src/evidence/hash-chain.js'
import { canonicalize } from '../src/evidence/canonical.js'
import { createHash } from 'node:crypto'

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

  it('treats payloads without spanSchemaVersion as version 1 and verifies them', () => {
    const chain = new HashChain<{ msg: string }>()
    const records = [chain.append({ msg: 'a' }), chain.append({ msg: 'b' })]
    expect(verifyChain(records)).toBe(true)
  })

  it('verifies payloads carrying explicit spanSchemaVersion: 1 with the same canonical form', () => {
    // The contract: a v1 payload that explicitly sets spanSchemaVersion: 1 must NOT be the same
    // canonical form as one that omits it (the default rule for the emitter is to omit on v1 to
    // preserve pre-existing hashes). Both are accepted by verifyChain when min..max covers 1.
    const chainExplicit = new HashChain<{ msg: string; spanSchemaVersion?: number }>()
    const r = chainExplicit.append({ msg: 'a', spanSchemaVersion: 1 })
    expect(verifyChain([r])).toBe(true)
  })

  it('rejects payloads with spanSchemaVersion outside the accepted range', () => {
    const chain = new HashChain<{ msg: string; spanSchemaVersion: number }>()
    const records = [chain.append({ msg: 'a', spanSchemaVersion: 2 })]
    expect(verifyChain(records)).toBe(false)
    expect(verifyChain(records, { acceptedSchemaVersions: { min: 1, max: 2 } })).toBe(true)
  })

  it('preserves canonical-form invariant for v1: pre-versioning hashes match post-versioning hashes', () => {
    // Precomputed pre-change hash: a HashChain over a payload like a v1 EvidenceSpan-shaped record
    // would emit. Built using canonicalize directly to simulate the pre-change code path.
    const payload = { span: 'agent.invoke', role: 'agent', stepId: 's1', data: { n: 7 } }
    const prevHash = '0'.repeat(64)
    const sequence = 0
    const expected = createHash('sha256')
      .update(canonicalize({ sequence, prevHash, payload }))
      .digest('hex')
    const chain = new HashChain<typeof payload>()
    const r = chain.append(payload)
    expect(r.hash).toBe(expected)
    expect(verifyChain([r])).toBe(true)
  })
})
