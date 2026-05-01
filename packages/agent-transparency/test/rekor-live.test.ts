import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'

const REKOR_URL = 'https://rekor.sigstore.dev'
const liveEnabled = process.env.CI_LIVE_REKOR === '1'

interface RekorLogInfoResponse {
  readonly rootHash: string
  readonly treeSize: number
  readonly treeID?: string
}

interface RekorEntryProof {
  readonly logIndex: number
  readonly rootHash: string
  readonly treeSize: number
  readonly hashes: readonly string[]
  readonly checkpoint?: string
}

interface RekorEntryRecord {
  readonly logID: string
  readonly logIndex: number
  readonly body: string
  readonly integratedTime: number
  readonly verification?: { readonly inclusionProof?: RekorEntryProof }
}

const sha256Hex = (input: Buffer): string =>
  createHash('sha256').update(input).digest('hex')

const decodeHashes = (hashes: readonly string[]): string[] =>
  hashes.map((h) => h.replace(/^sha256:/, ''))

const verifyRfc6962Inclusion = (
  leafHash: string,
  index: number,
  treeSize: number,
  proof: readonly string[],
  rootHash: string,
): boolean => {
  if (index < 0 || index >= treeSize) return false
  let hash = leafHash
  let lastNode = treeSize - 1
  let nodeIndex = index
  let proofIndex = 0
  while (lastNode > 0) {
    if (nodeIndex % 2 === 1 || nodeIndex === lastNode) {
      if (nodeIndex % 2 === 1) {
        const sibling = proof[proofIndex++]
        if (!sibling) return false
        hash = sha256Hex(
          Buffer.concat([Buffer.from([0x01]), Buffer.from(sibling, 'hex'), Buffer.from(hash, 'hex')]),
        )
      }
      while (nodeIndex % 2 === 0 && nodeIndex !== lastNode) {
        nodeIndex >>= 1
        lastNode >>= 1
      }
    } else {
      const sibling = proof[proofIndex++]
      if (!sibling) return false
      hash = sha256Hex(
        Buffer.concat([Buffer.from([0x01]), Buffer.from(hash, 'hex'), Buffer.from(sibling, 'hex')]),
      )
    }
    nodeIndex >>= 1
    lastNode >>= 1
  }
  if (proofIndex !== proof.length) return false
  return hash === rootHash
}

describe.skipIf(!liveEnabled)('Sigstore Rekor live integration', () => {
  it('fetches log info from the public-good instance', async () => {
    const res = await fetch(`${REKOR_URL}/api/v1/log`)
    expect(res.ok).toBe(true)
    const info = (await res.json()) as RekorLogInfoResponse
    expect(typeof info.rootHash).toBe('string')
    expect(info.rootHash.length).toBeGreaterThan(0)
    expect(typeof info.treeSize).toBe('number')
    expect(info.treeSize).toBeGreaterThan(0)
  }, 30_000)

  it('retrieves an entry by log index and verifies its inclusion proof', async () => {
    const infoRes = await fetch(`${REKOR_URL}/api/v1/log`)
    const info = (await infoRes.json()) as RekorLogInfoResponse
    const targetIndex = Math.max(0, info.treeSize - 100)

    const entryRes = await fetch(`${REKOR_URL}/api/v1/log/entries?logIndex=${targetIndex}`)
    expect(entryRes.ok).toBe(true)
    const entries = (await entryRes.json()) as Record<string, RekorEntryRecord>
    const uuid = Object.keys(entries)[0]
    expect(uuid).toBeDefined()
    const record = entries[uuid as string] as RekorEntryRecord
    expect(record.logIndex).toBe(targetIndex)
    expect(record.body).toBeDefined()

    const proof = record.verification?.inclusionProof
    expect(proof).toBeDefined()
    if (!proof) throw new Error('no inclusion proof')

    const bodyBuf = Buffer.from(record.body, 'base64')
    const leaf = sha256Hex(Buffer.concat([Buffer.from([0x00]), bodyBuf]))
    const valid = verifyRfc6962Inclusion(
      leaf,
      proof.logIndex,
      proof.treeSize,
      decodeHashes(proof.hashes),
      proof.rootHash,
    )
    expect(valid).toBe(true)
  }, 30_000)

  it('reports a clear error when fetching an out-of-range index', async () => {
    const res = await fetch(`${REKOR_URL}/api/v1/log/entries?logIndex=99999999999999`)
    expect(res.status).toBeGreaterThanOrEqual(400)
  }, 30_000)
})

describe.skipIf(liveEnabled)('Sigstore Rekor live integration (skipped without CI_LIVE_REKOR=1)', () => {
  it('is skipped by default', () => {
    expect(liveEnabled).toBe(false)
  })
})
