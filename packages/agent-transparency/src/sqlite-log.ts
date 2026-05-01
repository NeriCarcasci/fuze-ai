import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { migrateTransparencyLog } from './migrations.js'
import {
  buildInclusionProof,
  computeMerkleRoot,
  decodeProof,
  encodeProof,
  sha256Hex,
  verifyInclusionProof,
} from './merkle.js'
import {
  TransparencyDuplicateError,
  TransparencyNotFoundError,
  type TransparencyAnchor,
  type TransparencyEntry,
  type TransparencyLog,
  type TransparencyProof,
} from './types.js'

export interface SqliteTransparencyLogOptions {
  readonly databasePath: string
  readonly logName?: string
}

interface EntryRow {
  log_index: number
  log_id: string
  run_id: string
  chain_head: string
  signed_run_root_json: string
  observed_at: string
  leaf_hash: string
  parent_hash: string | null
}

export function leafHashOf(entry: TransparencyEntry): string {
  // Canonical serialisation: stable JSON of the load-bearing fields.
  // Produces a deterministic leaf so two parties hashing the same entry agree.
  const canonical = JSON.stringify({
    runId: entry.runId,
    chainHead: entry.chainHead,
    signedRunRoot: {
      runId: entry.signedRunRoot.runId,
      chainHead: entry.signedRunRoot.chainHead,
      nonce: entry.signedRunRoot.nonce,
      signature: entry.signedRunRoot.signature,
      publicKeyId: entry.signedRunRoot.publicKeyId,
      algorithm: entry.signedRunRoot.algorithm,
    },
    observedAt: entry.observedAt,
  })
  return sha256Hex(Buffer.from(canonical, 'utf8'))
}

export class SqliteTransparencyLog implements TransparencyLog {
  readonly name: string
  private readonly db: DatabaseSync

  constructor(opts: SqliteTransparencyLogOptions) {
    this.db = new DatabaseSync(opts.databasePath)
    migrateTransparencyLog(this.db)
    this.name = opts.logName ?? 'fuze-sqlite-transparency'
  }

  async append(entry: TransparencyEntry): Promise<TransparencyAnchor> {
    const leaf = leafHashOf(entry)
    const logId = randomUUID()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const existing = this.db
        .prepare('SELECT log_id FROM entries WHERE run_id = ?')
        .get(entry.runId) as { log_id: string } | undefined
      if (existing) {
        this.db.exec('ROLLBACK')
        throw new TransparencyDuplicateError(entry.runId)
      }
      const parentRow = this.db
        .prepare('SELECT leaf_hash FROM entries ORDER BY log_index DESC LIMIT 1')
        .get() as { leaf_hash: string } | undefined
      const parentHash = parentRow ? parentRow.leaf_hash : null

      const result = this.db
        .prepare(
          `INSERT INTO entries (
            log_id, run_id, chain_head, signed_run_root_json,
            observed_at, leaf_hash, parent_hash
          ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          logId,
          entry.runId,
          entry.chainHead,
          JSON.stringify(entry.signedRunRoot),
          entry.observedAt,
          leaf,
          parentHash,
        )
      this.db.exec('COMMIT')
      const logIndex = Number(result.lastInsertRowid)
      return {
        logId,
        logIndex,
        logName: this.name,
        observedAt: entry.observedAt,
      }
    } catch (err) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // already rolled back
      }
      throw err
    }
  }

  async prove(logId: string): Promise<TransparencyProof> {
    const target = this.db
      .prepare('SELECT * FROM entries WHERE log_id = ?')
      .get(logId) as unknown as EntryRow | undefined
    if (!target) {
      throw new TransparencyNotFoundError(logId)
    }
    const all = this.db
      .prepare('SELECT * FROM entries ORDER BY log_index ASC')
      .all() as unknown as EntryRow[]
    const leaves = all.map((r) => r.leaf_hash)
    const index = all.findIndex((r) => r.log_id === logId)
    const root = computeMerkleRoot(leaves)
    const proof = buildInclusionProof(leaves, index)
    return {
      logId,
      entry: rowToEntry(target),
      merkleProof: encodeProof(proof),
      rootHash: root,
    }
  }

  async verify(proof: TransparencyProof): Promise<boolean> {
    const decoded = decodeProof(proof.merkleProof)
    if (!decoded) return false
    if (!/^[0-9a-f]{64}$/.test(proof.rootHash)) return false
    const leaf = leafHashOf(proof.entry)
    return verifyInclusionProof(leaf, decoded, proof.rootHash)
  }

  close(): void {
    this.db.close()
  }
}

function rowToEntry(row: EntryRow): TransparencyEntry {
  return {
    runId: row.run_id,
    chainHead: row.chain_head,
    signedRunRoot: JSON.parse(row.signed_run_root_json) as TransparencyEntry['signedRunRoot'],
    observedAt: row.observed_at,
  }
}
