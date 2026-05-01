import type { ChainedRecord, EvidenceSpan, RetentionPolicy } from '@fuze-ai/agent'

export type ExpiredAction = 'hash-only' | 'drop-content' | 'drop-span'

export interface ExpiredEntry {
  readonly record: ChainedRecord<EvidenceSpan>
  readonly action: ExpiredAction
}

export interface PartitionByRetentionInput {
  readonly records: readonly ChainedRecord<EvidenceSpan>[]
  readonly policies: ReadonlyMap<string, RetentionPolicy>
  readonly now: Date
}

export interface PartitionByRetentionOutput {
  readonly keep: ChainedRecord<EvidenceSpan>[]
  readonly expired: ExpiredEntry[]
}

const MS_PER_DAY = 86_400_000

export class MissingRetentionPolicyError extends Error {
  constructor(public readonly policyId: string) {
    super(`retention policy not found: ${policyId}`)
    this.name = 'MissingRetentionPolicyError'
  }
}

export const partitionByRetention = (input: PartitionByRetentionInput): PartitionByRetentionOutput => {
  const keep: ChainedRecord<EvidenceSpan>[] = []
  const expired: ExpiredEntry[] = []
  const nowMs = input.now.getTime()

  for (const record of input.records) {
    const span = record.payload
    const policyId = span.common['fuze.retention.policy_id']
    const policy = input.policies.get(policyId)
    if (!policy) {
      throw new MissingRetentionPolicyError(policyId)
    }

    const endedMs = Date.parse(span.endedAt)
    const ageDays = (nowMs - endedMs) / MS_PER_DAY

    if (ageDays >= policy.decisionTtlDays) {
      expired.push({ record, action: 'drop-span' })
      continue
    }
    if (ageDays >= policy.hashTtlDays) {
      expired.push({ record, action: 'hash-only' })
      continue
    }
    if (ageDays >= policy.fullContentTtlDays && span.contentRef !== undefined) {
      expired.push({ record, action: 'drop-content' })
      continue
    }
    keep.push(record)
  }

  return { keep, expired }
}
