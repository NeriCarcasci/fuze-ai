/**
 * DurableExecutionAdapter implementations.
 *
 * The InMemoryDurableAdapter ships for tests + local dev. A real Restate
 * adapter lives in a follow-up package (@fuze-ai/agent-durable-restate)
 * and binds these methods to ctx.awakeable / restate.send.
 *
 * The contract mirrors Restate's awakeable primitive intentionally — it is
 * the cleanest TS-side fit for Article 14 oversight (durable promise,
 * external HTTP resolve, optional timeout).
 */

import type { DurableExecutionAdapter } from '../types/oversight-v2.js'

interface PendingAwakeable<T> {
  readonly id: string
  readonly resolve: (value: T) => void
  readonly reject: (reason: string) => void
  readonly timer?: ReturnType<typeof setTimeout>
}

export class InMemoryDurableAdapter implements DurableExecutionAdapter {
  private pending = new Map<string, PendingAwakeable<unknown>>()
  private idCounter = 0

  createAwakeable<T>(input: { oversightId: string; timeoutMs?: number }): Promise<{
    id: string
    promise: Promise<T>
  }> {
    const id = `awk_${input.oversightId}_${++this.idCounter}`
    let resolveFn!: (value: T) => void
    let rejectFn!: (reason: string) => void
    const promise = new Promise<T>((res, rej) => {
      resolveFn = res
      rejectFn = (reason) => rej(new Error(reason))
    })

    let timer: ReturnType<typeof setTimeout> | undefined
    if (input.timeoutMs !== undefined) {
      timer = setTimeout(() => {
        const entry = this.pending.get(id)
        if (entry) {
          this.pending.delete(id)
          entry.reject('timeout')
        }
      }, input.timeoutMs)
    }

    this.pending.set(id, {
      id,
      resolve: resolveFn as (value: unknown) => void,
      reject: rejectFn,
      ...(timer ? { timer } : {}),
    })

    return Promise.resolve({ id, promise })
  }

  resolveAwakeable<T>(id: string, value: T): Promise<void> {
    const entry = this.pending.get(id)
    if (!entry) {
      return Promise.reject(new Error(`No pending awakeable: ${id}`))
    }
    if (entry.timer) clearTimeout(entry.timer)
    this.pending.delete(id)
    entry.resolve(value as unknown)
    return Promise.resolve()
  }

  rejectAwakeable(id: string, reason: string): Promise<void> {
    const entry = this.pending.get(id)
    if (!entry) {
      return Promise.reject(new Error(`No pending awakeable: ${id}`))
    }
    if (entry.timer) clearTimeout(entry.timer)
    this.pending.delete(id)
    entry.reject(reason)
    return Promise.resolve()
  }

  pendingCount(): number {
    return this.pending.size
  }
}
