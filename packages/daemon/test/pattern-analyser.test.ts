import { describe, it, expect, beforeEach } from 'vitest'
import { PatternAnalyser } from '../src/pattern-analyser.js'

describe('PatternAnalyser', () => {
  let pa: PatternAnalyser

  beforeEach(() => {
    pa = new PatternAnalyser()
  })

  it('returns no alerts with fewer than 5 runs', () => {
    for (let i = 0; i < 4; i++) {
      pa.recordRunOutcome('agent-a', 'failed')
    }
    expect(pa.analyse()).toHaveLength(0)
  })

  it('emits repeated_failure alert when failure rate > 60%', () => {
    for (let i = 0; i < 7; i++) pa.recordRunOutcome('agent-a', 'failed')
    for (let i = 0; i < 3; i++) pa.recordRunOutcome('agent-a', 'completed')
    const alerts = pa.analyse()
    expect(alerts.some((a) => a.type === 'repeated_failure')).toBe(true)
  })

  it('classifies repeated_failure as critical when > 80% failure rate', () => {
    for (let i = 0; i < 9; i++) pa.recordRunOutcome('agent-a', 'failed')
    pa.recordRunOutcome('agent-a', 'completed')
    const alert = pa.analyse().find((a) => a.type === 'repeated_failure')
    expect(alert?.severity).toBe('critical')
  })

  it('does not emit repeated_failure when failure rate <= 60%', () => {
    for (let i = 0; i < 3; i++) pa.recordRunOutcome('agent-a', 'failed')
    for (let i = 0; i < 7; i++) pa.recordRunOutcome('agent-a', 'completed')
    const alerts = pa.analyse().filter((a) => a.type === 'repeated_failure')
    expect(alerts).toHaveLength(0)
  })

  it('emits token_spike when latest tokens > 2x avg of previous', () => {
    for (let i = 0; i < 4; i++) pa.recordRunOutcome('agent-a', 'completed', undefined, undefined, 1000)
    pa.recordRunOutcome('agent-a', 'completed', undefined, undefined, 3000)
    const alerts = pa.analyse()
    expect(alerts.some((a) => a.type === 'token_spike')).toBe(true)
  })

  it('does not emit token_spike when latest tokens are normal', () => {
    for (let i = 0; i < 4; i++) pa.recordRunOutcome('agent-a', 'completed', undefined, undefined, 1000)
    pa.recordRunOutcome('agent-a', 'completed', undefined, undefined, 1500)
    const alerts = pa.analyse().filter((a) => a.type === 'token_spike')
    expect(alerts).toHaveLength(0)
  })

  it('tracks topFailedTool in repeated_failure details', () => {
    for (let i = 0; i < 8; i++) pa.recordRunOutcome('agent-a', 'failed', 'step1', 'badTool', 0)
    for (let i = 0; i < 2; i++) pa.recordRunOutcome('agent-a', 'completed')
    const alert = pa.analyse().find((a) => a.type === 'repeated_failure')
    expect(alert?.details['topFailedTool']).toBe('badTool')
  })

  describe('getAgentReliability', () => {
    it('returns defaults for unknown agent', () => {
      const r = pa.getAgentReliability('unknown')
      expect(r.totalRuns).toBe(0)
      expect(r.successRate).toBe(1.0)
    })

    it('computes success rate correctly', () => {
      for (let i = 0; i < 3; i++) pa.recordRunOutcome('agent-b', 'completed', undefined, undefined, 1.0)
      for (let i = 0; i < 1; i++) pa.recordRunOutcome('agent-b', 'failed')
      const r = pa.getAgentReliability('agent-b')
      expect(r.successRate).toBeCloseTo(0.75)
    })

    it('identifies failure hotspot', () => {
      for (let i = 0; i < 3; i++) pa.recordRunOutcome('agent-b', 'failed', 'step1', 'toolX')
      pa.recordRunOutcome('agent-b', 'completed')
      const r = pa.getAgentReliability('agent-b')
      expect(r.failureHotspot?.tool).toBe('toolX')
    })

    it('evicts oldest 20% of agents when outcomes map exceeds 10,000', () => {
      for (let i = 0; i < 10_001; i++) {
        pa.recordRunOutcome(`agent-${i}`, 'completed')
      }

      // After exceeding 10k, oldest bucket should be evicted.
      expect(pa.getAgentReliability('agent-0').totalRuns).toBe(0)
      // Newer agents should remain.
      expect(pa.getAgentReliability('agent-10000').totalRuns).toBe(1)
    })
  })
})
