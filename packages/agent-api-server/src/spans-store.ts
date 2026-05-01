import type { ChainedRecord, EvidenceSpan } from '@fuze-ai/agent'

export interface SpansStoreAppendInput {
  readonly tenantId: string
  readonly records: readonly ChainedRecord<EvidenceSpan>[]
}

export interface SpansStoreQueryByRun {
  readonly tenantId: string
  readonly runId: string
}

export interface SpansStoreQueryBySubject {
  readonly tenantId: string
  readonly subjectHmac: string
  readonly since?: string
  readonly limit?: number
}

export interface SpansStore {
  append(input: SpansStoreAppendInput): Promise<void>
  byRun(input: SpansStoreQueryByRun): Promise<ChainedRecord<EvidenceSpan>[]>
  bySubject(input: SpansStoreQueryBySubject): Promise<ChainedRecord<EvidenceSpan>[]>
}

interface StoredRecord {
  readonly tenantId: string
  readonly record: ChainedRecord<EvidenceSpan>
}

export class InMemorySpansStore implements SpansStore {
  private readonly records: StoredRecord[] = []

  async append(input: SpansStoreAppendInput): Promise<void> {
    for (const record of input.records) {
      this.records.push({ tenantId: input.tenantId, record })
    }
  }

  async byRun(input: SpansStoreQueryByRun): Promise<ChainedRecord<EvidenceSpan>[]> {
    return this.records
      .filter((r) => r.tenantId === input.tenantId && r.record.payload.runId === input.runId)
      .map((r) => r.record)
      .sort((a, b) => a.sequence - b.sequence)
  }

  async bySubject(
    input: SpansStoreQueryBySubject,
  ): Promise<ChainedRecord<EvidenceSpan>[]> {
    const filtered = this.records.filter(
      (r) =>
        r.tenantId === input.tenantId &&
        r.record.payload.common['fuze.subject.ref'] === input.subjectHmac &&
        (input.since === undefined || r.record.payload.startedAt >= input.since),
    )
    const sorted = filtered
      .map((r) => r.record)
      .sort((a, b) => a.payload.startedAt.localeCompare(b.payload.startedAt))
    return input.limit !== undefined ? sorted.slice(0, input.limit) : sorted
  }
}
