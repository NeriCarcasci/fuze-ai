import type { ModelMessage } from './model.js'
import type { TenantId, RunId } from './brand.js'
import type { SubjectRef } from './compliance.js'

export interface MemoryReadInput {
  readonly tenant: TenantId
  readonly runId: RunId
  readonly subjectRef?: SubjectRef
  readonly limit?: number
}

export interface MemoryWriteInput {
  readonly tenant: TenantId
  readonly runId: RunId
  readonly subjectRef?: SubjectRef
  readonly messages: readonly ModelMessage[]
}

export interface FuzeMemory {
  read(input: MemoryReadInput): Promise<readonly ModelMessage[]>
  write(input: MemoryWriteInput): Promise<void>
  erase(subjectRef: SubjectRef): Promise<void>
}
