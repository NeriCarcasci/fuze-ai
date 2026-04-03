import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { appendFile, writeFile } from 'node:fs/promises'
import { createHash, createHmac, randomBytes } from 'node:crypto'
import * as os from 'node:os'
import { dirname, join } from 'node:path'
import type { StepRecord, GuardEventRecord } from './types.js'

interface RunStartRecord {
  recordType: 'run_start'
  runId: string
  agentId: string
  config: object
  timestamp: string
}

interface RunEndRecord {
  recordType: 'run_end'
  runId: string
  status: string
  timestamp: string
}

interface GuardEventEntry {
  recordType: 'guard_event'
  event: GuardEventRecord
}

interface ChainFields {
  hash: string
  prevHash: string
  signature?: string
  sequence: number
}

export type TraceEntry =
  | RunStartRecord
  | (StepRecord & { recordType: 'step' })
  | GuardEventEntry
  | RunEndRecord

export type SignedTraceEntry = (TraceEntry & ChainFields)

export interface VerifyChainResult {
  valid: boolean
  hmacValid: boolean
  firstInvalidIndex?: number
}

const ZERO_HASH = '0'.repeat(64)

function getAuditKeyPath(): string {
  return process.env['FUZE_AUDIT_KEY_PATH'] ?? join(os.homedir(), '.fuze', 'audit.key')
}

function ensureAuditKey(): Buffer {
  const keyPath = getAuditKeyPath()
  const keyDir = dirname(keyPath)
  mkdirSync(keyDir, { recursive: true })

  if (!existsSync(keyPath)) {
    writeFileSync(keyPath, randomBytes(32))
  }

  chmodSync(keyPath, 0o600)
  const key = readFileSync(keyPath)
  if (key.length !== 32) {
    throw new Error(`Invalid audit key length at ${keyPath}: expected 32 bytes, got ${key.length}`)
  }
  return key
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry))
  }
  if (value && typeof value === 'object') {
    const input = value as Record<string, unknown>
    const output: Record<string, unknown> = {}
    for (const key of Object.keys(input).sort()) {
      output[key] = canonicalize(input[key])
    }
    return output
  }
  return value
}

function stringifyForHash(value: unknown): string {
  return JSON.stringify(canonicalize(value))
}

function computeHash(entry: Omit<SignedTraceEntry, 'hash' | 'signature'>): string {
  return createHash('sha256').update(stringifyForHash(entry)).digest('hex')
}

function getEntryId(entry: TraceEntry): string {
  if (entry.recordType === 'step') return entry.stepId
  if (entry.recordType === 'guard_event') return entry.event.eventId
  return entry.runId
}

function hasSignatureFields(entry: TraceEntry | SignedTraceEntry): entry is SignedTraceEntry {
  const maybe = entry as Partial<SignedTraceEntry>
  return (
    typeof maybe.hash === 'string'
    && typeof maybe.prevHash === 'string'
    && typeof maybe.signature === 'string'
    && typeof maybe.sequence === 'number'
  )
}

function buildSignaturePayload(sequence: number, entryId: string, hash: string, prevHash: string): string {
  return `${sequence}|${entryId}|${hash}|${prevHash}`
}

function computeSignature(
  key: Buffer,
  sequence: number,
  entryId: string,
  hash: string,
  prevHash: string,
): string {
  return createHmac('sha256', key)
    .update(buildSignaturePayload(sequence, entryId, hash, prevHash))
    .digest('hex')
}

export function verifyChain(entries: TraceEntry[]): VerifyChainResult {
  if (entries.length === 0) return { valid: true, hmacValid: true }

  const key = ensureAuditKey()
  let previousHash: string | null = null
  let inferredSequence = 0

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]

    if (!hasSignatureFields(entry)) {
      continue
    }

    const expectedPrevHash = previousHash ?? entry.prevHash
    const base = { ...entry }
    delete (base as Partial<SignedTraceEntry>).hash
    delete (base as Partial<SignedTraceEntry>).signature
    const expectedHash = computeHash(base as Omit<SignedTraceEntry, 'hash' | 'signature'>)
    const sequence = entry.sequence ?? inferredSequence
    const expectedSignature = computeSignature(
      key,
      sequence,
      getEntryId(entry),
      expectedHash,
      expectedPrevHash,
    )

    const hashValid = entry.prevHash === expectedPrevHash && entry.hash === expectedHash
    const hmacValid = entry.signature === expectedSignature

    if (!hashValid || !hmacValid) {
      return {
        valid: hashValid,
        hmacValid,
        firstInvalidIndex: index,
      }
    }

    previousHash = entry.hash
    inferredSequence += 1
  }

  return { valid: true, hmacValid: true }
}

/**
 * Writes execution traces as JSONL to a local file.
 * Buffers records and flushes them to disk.
 */
export class TraceRecorder {
  private readonly key: Buffer
  private buffer: SignedTraceEntry[] = []
  private readonly outputPath: string
  private sequence = 0
  private lastHash: string | null = null

  /**
   * @param outputPath - Path to the JSONL output file. Default: './fuze-traces.jsonl'.
   */
  constructor(outputPath = './fuze-traces.jsonl') {
    this.outputPath = outputPath
    this.key = ensureAuditKey()
  }

  private appendSignedEntry(entry: TraceEntry): void {
    const prevHash = this.lastHash ?? ZERO_HASH
    const sequence = this.sequence
    const entryId = getEntryId(entry)
    const withChain = {
      ...entry,
      prevHash,
      sequence,
    } as Omit<SignedTraceEntry, 'hash' | 'signature'>
    const hash = computeHash(withChain)
    const signature = computeSignature(this.key, sequence, entryId, hash, prevHash)
    const signedEntry = {
      ...withChain,
      hash,
      signature,
    } as SignedTraceEntry

    this.buffer.push(signedEntry)
    this.lastHash = hash
    this.sequence += 1
  }

  /**
   * Records the start of a run.
   * @param runId - Unique run identifier.
   * @param agentId - Identifier for the agent/caller.
   * @param config - The resolved configuration for this run.
   */
  startRun(runId: string, agentId: string, config: object): void {
    this.appendSignedEntry({
      recordType: 'run_start',
      runId,
      agentId,
      config,
      timestamp: new Date().toISOString(),
    })
  }

  /**
   * Records a step execution.
   * @param step - The step record to log.
   */
  recordStep(step: StepRecord): void {
    this.appendSignedEntry({ ...step, recordType: 'step' })
  }

  /**
   * Records a guard event (loop detected, timeout, etc.).
   * @param event - The guard event record to log.
   */
  recordGuardEvent(event: GuardEventRecord): void {
    this.appendSignedEntry({ recordType: 'guard_event', event })
  }

  /**
   * Records the end of a run.
   * @param runId - The run identifier.
   * @param status - Final status (e.g., 'completed', 'failed', 'killed').
   */
  endRun(runId: string, status: string): void {
    this.appendSignedEntry({
      recordType: 'run_end',
      runId,
      status,
      timestamp: new Date().toISOString(),
    })
  }

  /**
   * Writes all buffered records to disk as JSONL (one JSON object per line).
   * Clears the buffer after writing.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return

    const lines = this.buffer.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
    this.buffer = []

    try {
      await appendFile(this.outputPath, lines, 'utf-8')
    } catch (err) {
      // If file doesn't exist yet, create it
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        await writeFile(this.outputPath, lines, 'utf-8')
      } else {
        throw err
      }
    }
  }

  /**
   * Returns the number of buffered (unflushed) records.
   */
  get pendingCount(): number {
    return this.buffer.length
  }

  /**
   * Returns the buffered entries (for testing).
   */
  getBuffer(): readonly SignedTraceEntry[] {
    return this.buffer
  }
}
