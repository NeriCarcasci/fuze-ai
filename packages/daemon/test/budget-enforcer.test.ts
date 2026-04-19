import { describe, it, expect, beforeEach } from 'vitest'
import { BudgetEnforcer } from '../src/budget-enforcer.js'

const CONFIG = { orgDailyTokenBudget: 10_000, perAgentDailyTokenBudget: 3_000, alertThreshold: 0.8 }

describe('BudgetEnforcer', () => {
  let be: BudgetEnforcer

  beforeEach(() => {
    be = new BudgetEnforcer(CONFIG)
  })

  it('allows spend within budget', () => {
    expect(be.checkBudget('agent-a', 1000)).toBeNull()
  })

  it('kills when org budget would be exceeded', () => {
    be.recordSpend('agent-a', 9500)
    const decision = be.checkBudget('agent-a', 1000)
    expect(decision?.action).toBe('kill')
    expect(decision?.reason).toContain('Org daily token budget')
  })

  it('kills when per-agent budget would be exceeded', () => {
    be.recordSpend('agent-a', 2900)
    const decision = be.checkBudget('agent-a', 200)
    expect(decision?.action).toBe('kill')
    expect(decision?.reason).toContain("Agent 'agent-a'")
  })

  it('records spend and updates org + agent counters', () => {
    be.recordSpend('agent-a', 1000)
    expect(be.getOrgSpend().today).toBe(1000)
    expect(be.getAgentSpend('agent-a').today).toBe(1000)
  })

  it('getOrgSpend remaining decreases after spend', () => {
    be.recordSpend('agent-a', 4000)
    expect(be.getOrgSpend().remaining).toBe(6000)
  })

  it('isAtAlertThreshold triggers at 80% of org budget', () => {
    be.recordSpend('agent-a', 8000)
    expect(be.isAtAlertThreshold()).toBe(true)
  })

  it('isAtAlertThreshold is false below threshold', () => {
    be.recordSpend('agent-a', 7900)
    expect(be.isAtAlertThreshold()).toBe(false)
  })

  it('getAllAgentSpend returns entries for known agents', () => {
    be.recordSpend('a1', 100)
    be.recordSpend('a2', 200)
    const all = be.getAllAgentSpend()
    expect(Object.keys(all)).toContain('a1')
    expect(Object.keys(all)).toContain('a2')
  })

  it('resetDaily zeroes all counters', () => {
    be.recordSpend('agent-a', 500)
    be.resetDaily()
    expect(be.getOrgSpend().today).toBe(0)
    expect(be.getAgentSpend('agent-a').today).toBe(0)
  })

  it('multiple agents share org budget', () => {
    be.recordSpend('a1', 5000)
    be.recordSpend('a2', 5000)
    const decision = be.checkBudget('a3', 1000)
    expect(decision?.action).toBe('kill')
  })
})
