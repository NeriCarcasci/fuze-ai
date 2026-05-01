import { describe, it, expect } from 'vitest'
import type { SignedRunRoot } from '@fuze-ai/agent'
import { RekorTransparencyLog } from '../src/rekor-log.js'
import { leafHashOf } from '../src/sqlite-log.js'
import {
  buildInclusionProof,
  computeMerkleRoot,
  encodeProof,
  sha256Hex,
} from '../src/merkle.js'
import type { TransparencyEntry } from '../src/types.js'

const signedRunRoot = (runId: string): SignedRunRoot => ({
  runId,
  chainHead: 'a'.repeat(64),
  nonce: 'n-' + runId,
  signature: 's-' + runId,
  publicKeyId: 'pk-test',
  algorithm: 'ed25519',
})

const makeEntry = (runId: string, observedAt = '2026-04-30T00:00:00.000Z'): TransparencyEntry => ({
  runId,
  chainHead: 'a'.repeat(64),
  signedRunRoot: signedRunRoot(runId),
  observedAt,
})

interface FetchCall {
  url: string
  init: RequestInit | undefined
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

describe('RekorTransparencyLog', () => {
  it('append posts to /api/v1/log/entries and parses anchor', async () => {
    const calls: FetchCall[] = []
    const stub: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init })
      return jsonResponse(201, { uuid: 'rekor-uuid-1', logIndex: 42 })
    }
    const log = new RekorTransparencyLog({ rekorUrl: 'https://rekor.test', fetch: stub })
    const anchor = await log.append(makeEntry('run-1'))
    expect(anchor.logId).toBe('rekor-uuid-1')
    expect(anchor.logIndex).toBe(42)
    expect(anchor.logName).toBe('rekor-public')
    expect(calls.length).toBe(1)
    expect(calls[0]!.url).toBe('https://rekor.test/api/v1/log/entries')
    expect(calls[0]!.init?.method).toBe('POST')
    const body = JSON.parse(String(calls[0]!.init?.body)) as { spec: { leafHash: string } }
    expect(body.spec.leafHash).toBe(leafHashOf(makeEntry('run-1')))
  })

  it('append throws on non-2xx', async () => {
    const stub: typeof fetch = async () =>
      new Response('boom', { status: 500, statusText: 'Internal Server Error' })
    const log = new RekorTransparencyLog({ rekorUrl: 'https://rekor.test', fetch: stub })
    await expect(log.append(makeEntry('run-1'))).rejects.toThrow(/rekor append failed: 500/)
  })

  it('prove fetches inclusion proof from /api/v1/log/entries/{id}/proof', async () => {
    const entry = makeEntry('run-1')
    const otherLeaves = [
      sha256Hex(Buffer.from('other-1', 'utf8')),
      sha256Hex(Buffer.from('other-2', 'utf8')),
      sha256Hex(Buffer.from('other-3', 'utf8')),
    ]
    const leafHash = leafHashOf(entry)
    const leaves = [leafHash, ...otherLeaves]
    const root = computeMerkleRoot(leaves)
    const proof = encodeProof(buildInclusionProof(leaves, 0))

    const stub: typeof fetch = async (input) => {
      const url = String(input)
      expect(url).toBe('https://rekor.test/api/v1/log/entries/rekor-uuid-1/proof')
      return jsonResponse(200, {
        uuid: 'rekor-uuid-1',
        logIndex: 0,
        rootHash: root,
        hashes: proof,
        entry,
      })
    }
    const log = new RekorTransparencyLog({ rekorUrl: 'https://rekor.test', fetch: stub })
    const result = await log.prove('rekor-uuid-1')
    expect(result.logId).toBe('rekor-uuid-1')
    expect(result.rootHash).toBe(root)
    expect(result.merkleProof).toEqual(proof)
  })

  it('verify works without contacting the log', async () => {
    const entry = makeEntry('run-1')
    const leafHash = leafHashOf(entry)
    const otherLeaves = [
      sha256Hex(Buffer.from('other-1', 'utf8')),
      sha256Hex(Buffer.from('other-2', 'utf8')),
    ]
    const leaves = [leafHash, ...otherLeaves]
    const root = computeMerkleRoot(leaves)
    const merkleProof = encodeProof(buildInclusionProof(leaves, 0))

    const stubThatShouldNotBeCalled: typeof fetch = async () => {
      throw new Error('verify must not call fetch')
    }
    const log = new RekorTransparencyLog({
      rekorUrl: 'https://rekor.test',
      fetch: stubThatShouldNotBeCalled,
    })
    const ok = await log.verify({ logId: 'rekor-uuid-1', entry, merkleProof, rootHash: root })
    expect(ok).toBe(true)

    const tampered = { ...entry, chainHead: 'b'.repeat(64) }
    const okTampered = await log.verify({
      logId: 'rekor-uuid-1',
      entry: tampered,
      merkleProof,
      rootHash: root,
    })
    expect(okTampered).toBe(false)
  })
})
