import { describe, it, expect, beforeEach } from 'vitest'
import { RunManager } from '../src/run-manager.js'

describe('RunManager', () => {
  let rm: RunManager

  beforeEach(() => {
    rm = new RunManager()
  })

  it('starts a run and makes it active', () => {
    rm.startRun('r1', 'agent-a', {})
    expect(rm.getActiveRunCount()).toBe(1)
    const run = rm.getRun('r1')
    expect(run).not.toBeNull()
    expect(run?.status).toBe('running')
    expect(run?.agentId).toBe('agent-a')
  })

  it('records steps and updates totalSteps / totalCost', () => {
    rm.startRun('r1', 'agent-a', {})
    rm.recordStep('r1', {
      stepId: 's1', stepNumber: 1, toolName: 'myTool',
      argsHash: 'abc', sideEffect: false, startedAt: new Date().toISOString(),
      costUsd: 0.05,
    })
    const run = rm.getRun('r1')
    expect(run?.totalSteps).toBe(1)
    expect(run?.totalCost).toBeCloseTo(0.05)
  })

  it('throws when recording a step for unknown run', () => {
    expect(() =>
      rm.recordStep('nonexistent', {
        stepId: 's1', stepNumber: 1, toolName: 't', argsHash: 'x',
        sideEffect: false, startedAt: new Date().toISOString(),
      }),
    ).toThrow("unknown run 'nonexistent'")
  })

  it('ends a run and moves it to ended set', () => {
    rm.startRun('r1', 'agent-a', {})
    rm.endRun('r1', 'completed', 0.1)
    expect(rm.getActiveRunCount()).toBe(0)
    const run = rm.getRun('r1')
    expect(run?.status).toBe('completed')
  })

  it('kills a run', () => {
    rm.startRun('r1', 'agent-a', {})
    rm.killRun('r1', 'budget exceeded')
    expect(rm.getActiveRunCount()).toBe(0)
    expect(rm.getRun('r1')?.status).toBe('killed')
  })

  it('returns null for unknown runId', () => {
    expect(rm.getRun('does-not-exist')).toBeNull()
  })

  it('getRunsByAgent returns both active and ended runs', () => {
    rm.startRun('r1', 'agent-a', {})
    rm.startRun('r2', 'agent-a', {})
    rm.endRun('r1', 'completed', 0)
    const runs = rm.getRunsByAgent('agent-a')
    expect(runs).toHaveLength(2)
  })

  it('records guard events tolerantly', () => {
    rm.startRun('r1', 'agent-a', {})
    // Should not throw even for unknown run
    expect(() =>
      rm.recordGuardEvent('unknown-run', {
        eventId: 'e1', eventType: 'loop_detected', severity: 'warning', details: {},
      }),
    ).not.toThrow()
  })

  it('evicts oldest endedRun when exceeding MAX_ENDED cap', () => {
    // MAX_ENDED is 1000, so start and end 1001 runs
    for (let i = 0; i < 1001; i++) {
      rm.startRun(`r-${i}`, 'agent-a', {})
      rm.endRun(`r-${i}`, 'completed', 0)
    }
    // First run should have been evicted
    expect(rm.getRun('r-0')).toBeNull()
    // Last run should still be there
    expect(rm.getRun('r-1000')).not.toBeNull()
  })
})
