export interface RunOwnershipStore {
  record(runId: string, tenantId: string): Promise<void> | void
  get(runId: string): Promise<string | undefined> | string | undefined
}

export class InMemoryRunOwnership implements RunOwnershipStore {
  private readonly map = new Map<string, string>()

  record(runId: string, tenantId: string): void {
    const existing = this.map.get(runId)
    if (existing && existing !== tenantId) {
      throw new RunOwnershipConflictError(runId, existing, tenantId)
    }
    this.map.set(runId, tenantId)
  }

  get(runId: string): string | undefined {
    return this.map.get(runId)
  }
}

export class RunOwnershipConflictError extends Error {
  constructor(
    readonly runId: string,
    readonly recordedTenantId: string,
    readonly attemptedTenantId: string,
  ) {
    super(`runId ${runId} already owned by ${recordedTenantId}; attempted by ${attemptedTenantId}`)
    this.name = 'RunOwnershipConflictError'
  }
}
