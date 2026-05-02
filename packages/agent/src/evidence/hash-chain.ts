import { createHash } from 'node:crypto'
import { canonicalize } from './canonical.js'

const ZERO_HASH = '0'.repeat(64)

export interface ChainedRecord<T> {
  readonly sequence: number
  readonly prevHash: string
  readonly hash: string
  readonly payload: T
}

export class HashChain<T = Record<string, unknown>> {
  private prev = ZERO_HASH
  private seq = 0

  append(payload: T): ChainedRecord<T> {
    const sequence = this.seq++
    const prevHash = this.prev
    const canonical = canonicalize({ sequence, prevHash, payload })
    const hash = createHash('sha256').update(canonical).digest('hex')
    this.prev = hash
    return { sequence, prevHash, hash, payload }
  }

  head(): string {
    return this.prev
  }

  sequence(): number {
    return this.seq
  }

  reset(): void {
    this.prev = ZERO_HASH
    this.seq = 0
  }

  resume(prevHash: string, nextSequence: number): void {
    if (typeof prevHash !== 'string' || prevHash.length !== 64) {
      throw new Error(`HashChain.resume: invalid prevHash length`)
    }
    if (!Number.isInteger(nextSequence) || nextSequence < 0) {
      throw new Error(`HashChain.resume: invalid nextSequence`)
    }
    this.prev = prevHash
    this.seq = nextSequence
  }
}

export interface VerifyChainOptions {
  readonly acceptedSchemaVersions?: { readonly min: number; readonly max: number }
}

const DEFAULT_ACCEPTED_VERSIONS = { min: 1, max: 1 } as const

const readSpanSchemaVersion = (payload: unknown): number => {
  if (payload === null || typeof payload !== 'object') return 1
  const v = (payload as { spanSchemaVersion?: unknown }).spanSchemaVersion
  if (v === undefined) return 1
  if (typeof v === 'number' && Number.isInteger(v) && v >= 1) return v
  return -1
}

export const verifyChain = <T>(
  records: readonly ChainedRecord<T>[],
  options: VerifyChainOptions = {},
): boolean => {
  const accepted = options.acceptedSchemaVersions ?? DEFAULT_ACCEPTED_VERSIONS
  let prev = ZERO_HASH
  for (let i = 0; i < records.length; i++) {
    const r = records[i]
    if (!r) return false
    if (r.sequence !== i) return false
    if (r.prevHash !== prev) return false
    const version = readSpanSchemaVersion(r.payload)
    if (version < accepted.min || version > accepted.max) return false
    const canonical = canonicalize({ sequence: r.sequence, prevHash: r.prevHash, payload: r.payload })
    const expected = createHash('sha256').update(canonical).digest('hex')
    if (expected !== r.hash) return false
    prev = r.hash
  }
  return true
}
