import type { CompensationResult, SideEffectEntry } from './types.js'

/**
 * Tracks which functions have real-world consequences and manages
 * compensation functions for rollback.
 */
export class SideEffectRegistry {
  private compensations = new Map<string, (...args: unknown[]) => unknown | Promise<unknown>>()
  private sideEffects: SideEffectEntry[] = []
  private rollbackTail: Promise<void> = Promise.resolve()

  /**
   * Register a compensation function for a tool name.
   * @param toolName - The name of the tool/function.
   * @param compensateFn - The function to call during rollback.
   */
  registerCompensation(
    toolName: string,
    compensateFn: (...args: unknown[]) => unknown | Promise<unknown>,
  ): void {
    this.compensations.set(toolName, compensateFn)
  }

  /**
   * Record that a side-effect occurred.
   * @param stepId - The unique step identifier.
   * @param toolName - The name of the tool that produced the side-effect.
   * @param result - The result of the tool call.
   */
  recordSideEffect(stepId: string, toolName: string, result: unknown): void {
    this.sideEffects.push({
      stepId,
      toolName,
      result,
      timestamp: new Date().toISOString(),
    })
  }

  /**
   * Execute rollback: call compensation functions in reverse chronological order,
   * starting from the specified step.
   * @param fromStepId - The step ID to start rolling back from (inclusive).
   * @returns An array of compensation results.
   */
  async rollback(fromStepId: string): Promise<CompensationResult[]> {
    return this.withRollbackLock(async () => {
      const startIdx = this.sideEffects.findIndex((e) => e.stepId === fromStepId)
      if (startIdx === -1) {
        // If stepId not found, roll back all side-effects
        return this.rollbackAll()
      }

      // Process in reverse order from the specified step
      const toRollback = this.sideEffects.slice(startIdx).reverse()
      return this.rollbackEntries(toRollback)
    })
  }

  /**
   * Check if a tool is marked as having side-effects (has a compensation registered).
   * @param toolName - The name of the tool.
   * @returns True if the tool has been registered as a side-effect producer.
   */
  isSideEffect(toolName: string): boolean {
    return this.compensations.has(toolName)
  }

  /**
   * Returns all recorded side-effects.
   */
  getEffects(): readonly SideEffectEntry[] {
    return this.sideEffects
  }

  private async rollbackAll(): Promise<CompensationResult[]> {
    const reversed = [...this.sideEffects].reverse()
    return this.rollbackEntries(reversed)
  }

  private async rollbackEntries(entries: readonly SideEffectEntry[]): Promise<CompensationResult[]> {
    const results: CompensationResult[] = []

    for (const entry of entries) {
      const compensateFn = this.compensations.get(entry.toolName)

      if (!compensateFn) {
        results.push({
          stepId: entry.stepId,
          toolName: entry.toolName,
          status: 'no_compensation',
          escalated: true,
        })
        continue
      }

      const startEpochMs = Date.now()
      const compensationStartedAt = new Date(startEpochMs).toISOString()
      let status: CompensationResult['status'] = 'compensated'
      let escalated = false
      let error: string | undefined

      try {
        await compensateFn(entry.result)
      } catch (err) {
        status = 'failed'
        escalated = true
        error = err instanceof Error ? err.message : String(err)
      } finally {
        const endEpochMs = Date.now()
        results.push({
          stepId: entry.stepId,
          toolName: entry.toolName,
          status,
          escalated,
          error,
          compensationStartedAt,
          compensationEndedAt: new Date(endEpochMs).toISOString(),
          compensationLatencyMs: endEpochMs - startEpochMs,
        })
      }
    }

    return results
  }

  private async withRollbackLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.rollbackTail
    let release = (): void => undefined
    this.rollbackTail = new Promise<void>((resolve) => {
      release = () => resolve()
    })

    await previous
    try {
      return await operation()
    } finally {
      release()
    }
  }
}
