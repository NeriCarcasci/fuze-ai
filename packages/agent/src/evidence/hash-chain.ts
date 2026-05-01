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

export const verifyChain = <T>(records: readonly ChainedRecord<T>[]): boolean => {
  let prev = ZERO_HASH
  for (let i = 0; i < records.length; i++) {
    const r = records[i]
    if (!r) return false
    if (r.sequence !== i) return false
    if (r.prevHash !== prev) return false
    const canonical = canonicalize({ sequence: r.sequence, prevHash: r.prevHash, payload: r.payload })
    const expected = createHash('sha256').update(canonical).digest('hex')
    if (expected !== r.hash) return false
    prev = r.hash
  }
  return true
}
