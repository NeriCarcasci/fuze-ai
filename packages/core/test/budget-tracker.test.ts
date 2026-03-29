import { describe, it, expect } from 'vitest'
import { BudgetTracker } from '../src/budget-tracker.js'
import { BudgetExceeded } from '../src/errors.js'

describe('BudgetTracker', () => {
  it('throws BudgetExceeded when run ceiling would be breached', () => {
    const tracker = new BudgetTracker(Infinity, 1.0)

    // Two steps at $0.40 each = $0.80 total, within $1.00 ceiling
    tracker.checkBudget(0.40, 'step1')
    tracker.recordCost(0.40, 100, 50)

    tracker.checkBudget(0.40, 'step2')
    tracker.recordCost(0.40, 100, 50)

    // Third step at $0.40 would push total to $1.20, exceeding $1.00 ceiling
    expect(() => tracker.checkBudget(0.40, 'step3')).toThrow(BudgetExceeded)
  })

  it('throws BudgetExceeded when step ceiling is exceeded', () => {
    const tracker = new BudgetTracker(0.50, Infinity)

    expect(() => tracker.checkBudget(0.60, 'analyse')).toThrow(BudgetExceeded)
  })

  it('includes actionable details in the error message', () => {
    const tracker = new BudgetTracker(0.50, Infinity)

    try {
      tracker.checkBudget(0.60, 'analyse')
      expect.unreachable('should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(BudgetExceeded)
      const error = err as BudgetExceeded
      expect(error.message).toContain("step 'analyse'")
      expect(error.message).toContain('$0.6000')
      expect(error.message).toContain('$0.5000')
      expect(error.level).toBe('step')
    }
  })

  it('accumulates correctly without throwing when no ceiling is set', () => {
    const tracker = new BudgetTracker()

    tracker.checkBudget(1.00, 'step1')
    tracker.recordCost(1.00, 500, 200)

    tracker.checkBudget(2.00, 'step2')
    tracker.recordCost(2.00, 1000, 400)

    tracker.checkBudget(5.00, 'step3')
    tracker.recordCost(5.00, 2000, 800)

    const status = tracker.getStatus()
    expect(status.totalCost).toBe(8.00)
    expect(status.totalTokensIn).toBe(3500)
    expect(status.totalTokensOut).toBe(1400)
    expect(status.stepCount).toBe(3)
  })

  it('returns accurate totals after N steps via getStatus()', () => {
    const tracker = new BudgetTracker()

    tracker.recordCost(0.10, 100, 50)
    tracker.recordCost(0.20, 200, 100)
    tracker.recordCost(0.30, 300, 150)

    const status = tracker.getStatus()
    expect(status.totalCost).toBeCloseTo(0.60, 10)
    expect(status.totalTokensIn).toBe(600)
    expect(status.totalTokensOut).toBe(300)
    expect(status.stepCount).toBe(3)
  })

  it('throws run-level error with correct details', () => {
    const tracker = new BudgetTracker(Infinity, 1.00)

    tracker.recordCost(0.42, 200, 100)

    try {
      tracker.checkBudget(0.60, 'analyse')
      expect.unreachable('should have thrown')
    } catch (err) {
      const error = err as BudgetExceeded
      expect(error.level).toBe('run')
      expect(error.spent).toBeCloseTo(0.42, 10)
      expect(error.estimatedCost).toBeCloseTo(0.60, 10)
    }
  })
})
