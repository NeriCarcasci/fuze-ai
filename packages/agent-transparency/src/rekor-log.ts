import {
  decodeProof,
  sha256Hex,
  verifyInclusionProof,
} from './merkle.js'
import { leafHashOf } from './sqlite-log.js'
import {
  TransparencyNotFoundError,
  type TransparencyAnchor,
  type TransparencyEntry,
  type TransparencyLog,
  type TransparencyProof,
} from './types.js'

export interface RekorTransparencyLogOptions {
  readonly rekorUrl?: string
  readonly fetch?: typeof fetch
  readonly logName?: string
}

interface RekorCreateResponse {
  readonly uuid: string
  readonly logIndex: number
  readonly integratedTime?: number
}

interface RekorProofResponse {
  readonly uuid: string
  readonly logIndex: number
  readonly rootHash: string
  readonly hashes: readonly string[]
  readonly entry: TransparencyEntry
}

const DEFAULT_REKOR_URL = 'https://rekor.sigstore.dev'

export class RekorTransparencyLog implements TransparencyLog {
  readonly name: string
  private readonly rekorUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(opts: RekorTransparencyLogOptions = {}) {
    this.rekorUrl = opts.rekorUrl ?? DEFAULT_REKOR_URL
    const f = opts.fetch ?? globalThis.fetch
    if (typeof f !== 'function') {
      throw new Error('RekorTransparencyLog: no fetch implementation available')
    }
    this.fetchImpl = f
    this.name = opts.logName ?? 'rekor-public'
  }

  async append(entry: TransparencyEntry): Promise<TransparencyAnchor> {
    const leaf = leafHashOf(entry)
    const body = {
      kind: 'fuze-runroot',
      apiVersion: '0.0.1',
      spec: {
        runId: entry.runId,
        chainHead: entry.chainHead,
        observedAt: entry.observedAt,
        leafHash: leaf,
        signedRunRoot: entry.signedRunRoot,
      },
    }
    const res = await this.fetchImpl(`${this.rekorUrl}/api/v1/log/entries`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      throw new Error(`rekor append failed: ${res.status} ${res.statusText}`)
    }
    const json = (await res.json()) as RekorCreateResponse
    return {
      logId: json.uuid,
      logIndex: json.logIndex,
      logName: this.name,
      observedAt: entry.observedAt,
    }
  }

  async prove(logId: string): Promise<TransparencyProof> {
    const res = await this.fetchImpl(
      `${this.rekorUrl}/api/v1/log/entries/${encodeURIComponent(logId)}/proof`,
      { method: 'GET', headers: { accept: 'application/json' } },
    )
    if (res.status === 404) {
      throw new TransparencyNotFoundError(logId)
    }
    if (!res.ok) {
      throw new Error(`rekor prove failed: ${res.status} ${res.statusText}`)
    }
    const json = (await res.json()) as RekorProofResponse
    return {
      logId,
      entry: json.entry,
      merkleProof: json.hashes,
      rootHash: json.rootHash,
    }
  }

  async verify(proof: TransparencyProof): Promise<boolean> {
    const decoded = decodeProof(proof.merkleProof)
    if (!decoded) return false
    if (!/^[0-9a-f]{64}$/.test(proof.rootHash)) return false
    const leaf = leafHashOf(proof.entry)
    return verifyInclusionProof(leaf, decoded, proof.rootHash)
  }
}

export { sha256Hex }
