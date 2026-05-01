import type { ModelMessage } from '@fuze-ai/agent'

export interface CompletedToolCall {
  readonly toolName: string
  readonly argsHash: string
  readonly outputHash: string
}

export interface DurableRunSnapshot {
  readonly runId: string
  readonly tenant: string
  readonly principal: string
  readonly subjectHmac?: string
  readonly stepsUsed: number
  readonly retriesUsed: number
  readonly chainHead: string
  readonly lastSequence: number
  readonly history: readonly ModelMessage[]
  readonly completedToolCalls: readonly CompletedToolCall[]
  readonly suspendedToolName?: string
  readonly suspendedToolArgs?: Readonly<Record<string, unknown>>
  readonly snapshotAt: string
}

export interface DurableRunStore {
  save(snapshot: DurableRunSnapshot): Promise<void>
  load(runId: string): Promise<DurableRunSnapshot | null>
  clear(runId: string): Promise<void>
  markResolved(runId: string): Promise<void>
  eraseBySubjectRef(subjectHmac: string): Promise<number>
  listOrphaned(olderThan: Date): Promise<readonly string[]>
}
