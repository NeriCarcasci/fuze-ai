import { createHash } from 'node:crypto'

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex')
}

export function hashPair(left: string, right: string): string {
  return sha256Hex(Buffer.from(left + right, 'utf8'))
}

export function computeMerkleRoot(leaves: readonly string[]): string {
  if (leaves.length === 0) {
    throw new Error('computeMerkleRoot: empty leaf set')
  }
  let level: string[] = [...leaves]
  while (level.length > 1) {
    const next: string[] = []
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i] as string
      const right = i + 1 < level.length ? (level[i + 1] as string) : left
      next.push(hashPair(left, right))
    }
    level = next
  }
  return level[0] as string
}

export interface InclusionStep {
  readonly hash: string
  readonly position: 'left' | 'right'
}

export function buildInclusionProof(
  leaves: readonly string[],
  index: number,
): readonly InclusionStep[] {
  if (index < 0 || index >= leaves.length) {
    throw new Error(`buildInclusionProof: index ${index} out of range`)
  }
  const proof: InclusionStep[] = []
  let level: string[] = [...leaves]
  let idx = index
  while (level.length > 1) {
    const isRight = idx % 2 === 1
    const siblingIdx = isRight ? idx - 1 : idx + 1
    const sibling =
      siblingIdx < level.length ? (level[siblingIdx] as string) : (level[idx] as string)
    proof.push({ hash: sibling, position: isRight ? 'left' : 'right' })
    const next: string[] = []
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i] as string
      const right = i + 1 < level.length ? (level[i + 1] as string) : left
      next.push(hashPair(left, right))
    }
    level = next
    idx = Math.floor(idx / 2)
  }
  return proof
}

export function verifyInclusionProof(
  leafHash: string,
  proof: readonly InclusionStep[],
  rootHash: string,
): boolean {
  let cursor = leafHash
  for (const step of proof) {
    if (step.position === 'left') {
      cursor = hashPair(step.hash, cursor)
    } else if (step.position === 'right') {
      cursor = hashPair(cursor, step.hash)
    } else {
      return false
    }
  }
  return cursor === rootHash
}

export function encodeProof(proof: readonly InclusionStep[]): readonly string[] {
  return proof.map((s) => `${s.position}:${s.hash}`)
}

export function decodeProof(encoded: readonly string[]): readonly InclusionStep[] | null {
  const out: InclusionStep[] = []
  for (const e of encoded) {
    const sep = e.indexOf(':')
    if (sep < 0) return null
    const position = e.slice(0, sep)
    const hash = e.slice(sep + 1)
    if (position !== 'left' && position !== 'right') return null
    if (!/^[0-9a-f]{64}$/.test(hash)) return null
    out.push({ hash, position })
  }
  return out
}
