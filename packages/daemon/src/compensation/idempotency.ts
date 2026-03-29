import { createHash, randomUUID } from 'node:crypto'
import type { AuditStore } from '../audit-store.js'
import type { IdempotencyRecord } from './types.js'

/**
 * Prevents duplicate tool executions within the same run.
 *
 * Key design: the key is scoped to the run (runId + toolName + argsHash),
 * so the same tool+args in different runs are NOT considered duplicates.
 */
export class IdempotencyManager {
  constructor(private readonly auditStore: AuditStore) {}

  /**
   * Generate a per-run idempotency key hash.
   * Same toolName+argsHash in different runs produces a different key.
   */
  generateKey(runId: string, toolName: string, argsHash: string): string {
    return createHash('sha256')
      .update(`${runId}:${toolName}:${argsHash}`)
      .digest('hex')
  }

  /** Returns true if this exact tool+args combination has already run in this run. */
  async isDuplicate(key: string): Promise<boolean> {
    const record = await this.auditStore.getIdempotencyKey(key)
    return record !== null
  }

  /** Record a completed execution so future identical calls return the cache. */
  async recordExecution(
    key: string,
    runId: string,
    stepId: string,
    toolName: string,
    argsHash: string,
    result: unknown,
  ): Promise<void> {
    await this.auditStore.insertIdempotencyKey({
      keyHash: key,
      runId,
      stepId,
      toolName,
      argsHash,
      createdAt: new Date().toISOString(),
      resultJson: result !== undefined ? JSON.stringify(result) : null,
    })
  }

  /** Returns the cached result for a duplicate call, or null if not found. */
  async getCachedResult(key: string): Promise<unknown | null> {
    const record = await this.auditStore.getIdempotencyKey(key)
    if (!record || record.resultJson === null) return null
    try {
      return JSON.parse(record.resultJson) as unknown
    } catch {
      return null
    }
  }
}
