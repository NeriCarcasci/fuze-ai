import { describe, it, expect } from 'vitest'
import {
  buildInclusionProof,
  computeMerkleRoot,
  encodeProof,
  decodeProof,
  hashPair,
  sha256Hex,
  verifyInclusionProof,
} from '../src/merkle.js'

const leaf = (s: string): string => sha256Hex(Buffer.from(s, 'utf8'))

describe('merkle', () => {
  it('single-leaf root is the leaf itself', () => {
    const a = leaf('a')
    expect(computeMerkleRoot([a])).toBe(a)
    const proof = buildInclusionProof([a], 0)
    expect(proof.length).toBe(0)
    expect(verifyInclusionProof(a, proof, a)).toBe(true)
  })

  it('two-leaf tree root is hashPair(a,b)', () => {
    const a = leaf('a')
    const b = leaf('b')
    const root = computeMerkleRoot([a, b])
    expect(root).toBe(hashPair(a, b))
    const proofA = buildInclusionProof([a, b], 0)
    expect(verifyInclusionProof(a, proofA, root)).toBe(true)
    const proofB = buildInclusionProof([a, b], 1)
    expect(verifyInclusionProof(b, proofB, root)).toBe(true)
  })

  it('four-leaf balanced tree validates every leaf', () => {
    const ls = ['a', 'b', 'c', 'd'].map(leaf)
    const root = computeMerkleRoot(ls)
    const expected = hashPair(
      hashPair(ls[0]!, ls[1]!),
      hashPair(ls[2]!, ls[3]!),
    )
    expect(root).toBe(expected)
    for (let i = 0; i < ls.length; i++) {
      const proof = buildInclusionProof(ls, i)
      expect(verifyInclusionProof(ls[i]!, proof, root)).toBe(true)
    }
  })

  it('odd-leaf tree duplicates last leaf at each unbalanced level', () => {
    const ls = ['a', 'b', 'c'].map(leaf)
    const root = computeMerkleRoot(ls)
    const expected = hashPair(
      hashPair(ls[0]!, ls[1]!),
      hashPair(ls[2]!, ls[2]!),
    )
    expect(root).toBe(expected)
    for (let i = 0; i < ls.length; i++) {
      const proof = buildInclusionProof(ls, i)
      expect(verifyInclusionProof(ls[i]!, proof, root)).toBe(true)
    }
  })

  it('first-leaf inclusion proof in a five-leaf tree', () => {
    const ls = ['a', 'b', 'c', 'd', 'e'].map(leaf)
    const root = computeMerkleRoot(ls)
    const proof = buildInclusionProof(ls, 0)
    expect(verifyInclusionProof(ls[0]!, proof, root)).toBe(true)
    expect(verifyInclusionProof(leaf('z'), proof, root)).toBe(false)
  })

  it('last-leaf inclusion proof in a five-leaf tree', () => {
    const ls = ['a', 'b', 'c', 'd', 'e'].map(leaf)
    const root = computeMerkleRoot(ls)
    const proof = buildInclusionProof(ls, 4)
    expect(verifyInclusionProof(ls[4]!, proof, root)).toBe(true)
  })

  it('malformed encoded proof returns false / null', () => {
    const ls = ['a', 'b'].map(leaf)
    const root = computeMerkleRoot(ls)
    const proof = buildInclusionProof(ls, 0)
    const encoded = encodeProof(proof)
    const decoded = decodeProof(encoded)
    expect(decoded).not.toBeNull()
    expect(decodeProof(['garbage'])).toBeNull()
    expect(decodeProof(['middle:abcd'])).toBeNull()
    expect(decodeProof(['left:not-a-hash'])).toBeNull()
    // Tampered hash inside an otherwise-valid proof
    const tampered = [`left:${'0'.repeat(64)}`]
    const decTampered = decodeProof(tampered)!
    expect(verifyInclusionProof(ls[0]!, decTampered, root)).toBe(false)
  })
})
