import { describe, it, expect } from 'vitest'
import { UsageTracker } from '../src/budget-tracker.js'

describe('UsageTracker', () => {
  it('accumulates token usage correctly', () => {
    const tracker = new UsageTracker()

    tracker.recordUsage(500, 200)
    tracker.recordUsage(1000, 400)
    tracker.recordUsage(2000, 800)

    const status = tracker.getStatus()
    expect(status.totalTokensIn).toBe(3500)
    expect(status.totalTokensOut).toBe(1400)
    expect(status.stepCount).toBe(3)
  })

  it('returns accurate totals after N steps via getStatus()', () => {
    const tracker = new UsageTracker()

    tracker.recordUsage(100, 50)
    tracker.recordUsage(200, 100)
    tracker.recordUsage(300, 150)

    const status = tracker.getStatus()
    expect(status.totalTokensIn).toBe(600)
    expect(status.totalTokensOut).toBe(300)
    expect(status.stepCount).toBe(3)
  })

  it('starts with zero totals', () => {
    const tracker = new UsageTracker()

    const status = tracker.getStatus()
    expect(status.totalTokensIn).toBe(0)
    expect(status.totalTokensOut).toBe(0)
    expect(status.stepCount).toBe(0)
  })
})
