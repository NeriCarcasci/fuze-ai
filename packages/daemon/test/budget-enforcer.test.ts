import { describe, it, expect, beforeEach } from 'vitest'
import { BudgetEnforcer } from '../src/budget-enforcer.js'

const CONFIG = { orgDailyBudget: 10, perAgentDailyBudget: 3, alertThreshold: 0.8 }

describe('BudgetEnforcer', () => {
  let be: BudgetEnforcer

  beforeEach(() => {
    be = new BudgetEnforcer(CONFIG)
  })

  it('allows spend within budget', () => {
    expect(be.checkBudget('agent-a', 1.0)).toBeNull()
  })

  it('kills when org budget would be exceeded', () => {
    be.recordSpend('agent-a', 9.5)
    const decision = be.checkBudget('agent-a', 1.0)
    expect(decision?.action).toBe('kill')
    expect(decision?.reason).toContain('Org daily budget')
  })

  it('kills when per-agent budget would be exceeded', () => {
    be.recordSpend('agent-a', 2.9)
    const decision = be.checkBudget('agent-a', 0.2)
    expect(decision?.action).toBe('kill')
    expect(decision?.reason).toContain("Agent 'agent-a'")
  })

  it('records spend and updates org + agent counters', () => {
    be.recordSpend('agent-a', 1.0)
    expect(be.getOrgSpend().today).toBeCloseTo(1.0)
    expect(be.getAgentSpend('agent-a').today).toBeCloseTo(1.0)
  })

  it('getOrgSpend remaining decreases after spend', () => {
    be.recordSpend('agent-a', 4.0)
    expect(be.getOrgSpend().remaining).toBeCloseTo(6.0)
  })

  it('isAtAlertThreshold triggers at 80% of org budget', () => {
    be.recordSpend('agent-a', 8.0)
    expect(be.isAtAlertThreshold()).toBe(true)
  })

  it('isAtAlertThreshold is false below threshold', () => {
    be.recordSpend('agent-a', 7.9)
    expect(be.isAtAlertThreshold()).toBe(false)
  })

  it('getAllAgentSpend returns entries for known agents', () => {
    be.recordSpend('a1', 1)
    be.recordSpend('a2', 2)
    const all = be.getAllAgentSpend()
    expect(Object.keys(all)).toContain('a1')
    expect(Object.keys(all)).toContain('a2')
  })

  it('resetDaily zeroes all counters', () => {
    be.recordSpend('agent-a', 5)
    be.resetDaily()
    expect(be.getOrgSpend().today).toBe(0)
    expect(be.getAgentSpend('agent-a').today).toBe(0)
  })

  it('multiple agents share org budget', () => {
    be.recordSpend('a1', 5)
    be.recordSpend('a2', 5)
    const decision = be.checkBudget('a3', 1.0)
    expect(decision?.action).toBe('kill')
  })
})
