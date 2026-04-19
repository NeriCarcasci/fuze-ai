import { ResourceLimitExceeded } from './errors.js'
import type { ResourceLimits, ResourceUsageStatus } from './types.js'

export class ResourceLimitTracker {
  private totalTokensIn = 0
  private totalTokensOut = 0
  private stepCount = 0
  private readonly startedAt = Date.now()
  private readonly limits: ResourceLimits
  private reservationLock: Promise<void> = Promise.resolve()

  constructor(limits: ResourceLimits = {}) {
    this.limits = limits
  }

  async checkAndReserveStep(toolName: string): Promise<void> {
    await this.serialize(() => {
      this.assertWithinLimits(toolName)
      this.stepCount++
    })
  }

  recordUsage(tokensIn: number, tokensOut: number): void {
    if (Number.isFinite(tokensIn) && tokensIn >= 0) {
      this.totalTokensIn += tokensIn
    }
    if (Number.isFinite(tokensOut) && tokensOut >= 0) {
      this.totalTokensOut += tokensOut
    }
  }

  getStatus(): ResourceUsageStatus {
    return {
      totalTokensIn: this.totalTokensIn,
      totalTokensOut: this.totalTokensOut,
      stepCount: this.stepCount,
      wallClockMs: Date.now() - this.startedAt,
    }
  }

  getLimits(): ResourceLimits {
    return { ...this.limits }
  }

  private assertWithinLimits(toolName: string): void {
    const { maxSteps, maxTokensPerRun, maxWallClockMs } = this.limits

    if (typeof maxSteps === 'number' && this.stepCount + 1 > maxSteps) {
      throw new ResourceLimitExceeded({
        toolName,
        limit: 'maxSteps',
        ceiling: maxSteps,
        observed: this.stepCount + 1,
      })
    }

    const totalTokens = this.totalTokensIn + this.totalTokensOut
    if (typeof maxTokensPerRun === 'number' && totalTokens > maxTokensPerRun) {
      throw new ResourceLimitExceeded({
        toolName,
        limit: 'maxTokensPerRun',
        ceiling: maxTokensPerRun,
        observed: totalTokens,
      })
    }

    if (typeof maxWallClockMs === 'number') {
      const elapsed = Date.now() - this.startedAt
      if (elapsed > maxWallClockMs) {
        throw new ResourceLimitExceeded({
          toolName,
          limit: 'maxWallClockMs',
          ceiling: maxWallClockMs,
          observed: elapsed,
        })
      }
    }
  }

  private async serialize<T>(fn: () => T | Promise<T>): Promise<T> {
    const previous = this.reservationLock
    let release!: () => void
    this.reservationLock = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      return await fn()
    } finally {
      release()
    }
  }
}
