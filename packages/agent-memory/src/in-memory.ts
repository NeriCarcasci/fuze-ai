import type {
  FuzeMemory,
  MemoryReadInput,
  MemoryWriteInput,
  ModelMessage,
  SubjectRef,
  TenantId,
  RunId,
} from '@fuze-ai/agent'

interface Entry {
  readonly subjectHmac: string | undefined
  readonly messages: readonly ModelMessage[]
}

export class InMemoryMemory implements FuzeMemory {
  private readonly tenants = new Map<TenantId, Map<RunId, Entry[]>>()

  async read(input: MemoryReadInput): Promise<readonly ModelMessage[]> {
    const runs = this.tenants.get(input.tenant)
    if (!runs) return []
    const entries = runs.get(input.runId)
    if (!entries) return []

    const filtered =
      input.subjectRef === undefined
        ? entries
        : entries.filter((e) => e.subjectHmac === input.subjectRef!.hmac)

    const flat = filtered.flatMap((e) => e.messages)
    if (input.limit !== undefined && input.limit >= 0 && flat.length > input.limit) {
      return flat.slice(flat.length - input.limit)
    }
    return flat
  }

  async write(input: MemoryWriteInput): Promise<void> {
    let runs = this.tenants.get(input.tenant)
    if (!runs) {
      runs = new Map()
      this.tenants.set(input.tenant, runs)
    }
    let entries = runs.get(input.runId)
    if (!entries) {
      entries = []
      runs.set(input.runId, entries)
    }
    entries.push({
      subjectHmac: input.subjectRef?.hmac,
      messages: input.messages.map((m) => ({ ...m })),
    })
  }

  async erase(subjectRef: SubjectRef): Promise<void> {
    const target = subjectRef.hmac
    for (const [, runs] of this.tenants) {
      for (const [runId, entries] of runs) {
        const kept = entries.filter((e) => e.subjectHmac !== target)
        if (kept.length === 0) {
          runs.delete(runId)
        } else if (kept.length !== entries.length) {
          runs.set(runId, kept)
        }
      }
    }
  }
}
