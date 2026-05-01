import type { SignedRunRoot } from '@fuze-ai/agent'

export interface TransparencyEntry {
  readonly runId: string
  readonly chainHead: string
  readonly signedRunRoot: SignedRunRoot
  readonly observedAt: string
}

export interface TransparencyAnchor {
  readonly logId: string
  readonly logIndex: number
  readonly logName: string
  readonly observedAt: string
}

export interface TransparencyProof {
  readonly logId: string
  readonly entry: TransparencyEntry
  readonly merkleProof: readonly string[]
  readonly rootHash: string
}

export interface TransparencyLog {
  readonly name: string
  append(entry: TransparencyEntry): Promise<TransparencyAnchor>
  prove(logId: string): Promise<TransparencyProof>
  verify(proof: TransparencyProof): Promise<boolean>
}

export class TransparencyNotFoundError extends Error {
  constructor(logId: string) {
    super(`transparency entry not found: ${logId}`)
    this.name = 'TransparencyNotFoundError'
  }
}

export class TransparencyDuplicateError extends Error {
  constructor(runId: string) {
    super(`transparency entry already exists for runId: ${runId}`)
    this.name = 'TransparencyDuplicateError'
  }
}
