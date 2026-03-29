import { describe, it, expect, beforeEach, vi } from 'vitest'
import { AlertManager } from '../src/alert-manager.js'

describe('AlertManager', () => {
  let am: AlertManager

  beforeEach(() => {
    am = new AlertManager({ dedupWindowMs: 1000, webhookUrls: [] })
  })

  it('emits an alert and records it in history', () => {
    am.emit({ type: 'budget_exceeded', severity: 'action', message: 'over limit' })
    const history = am.getHistory()
    expect(history).toHaveLength(1)
    expect(history[0].type).toBe('budget_exceeded')
  })

  it('deduplicates identical alerts within window', () => {
    am.emit({ type: 'budget_exceeded', severity: 'action', message: 'over limit' })
    am.emit({ type: 'budget_exceeded', severity: 'action', message: 'over limit' })
    expect(am.getHistory()).toHaveLength(1)
  })

  it('allows same alert after clearDedup', () => {
    am.emit({ type: 'budget_exceeded', severity: 'action', message: 'over limit' })
    am.clearDedup()
    am.emit({ type: 'budget_exceeded', severity: 'action', message: 'over limit' })
    expect(am.getHistory()).toHaveLength(2)
  })

  it('emits different alert types without dedup', () => {
    am.emit({ type: 'budget_exceeded', severity: 'action', message: 'over limit' })
    am.emit({ type: 'loop_detected', severity: 'warning', message: 'loop' })
    expect(am.getHistory()).toHaveLength(2)
  })

  it('writes to stderr on emit', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    am.emit({ type: 'test_alert', severity: 'warning', message: 'test' })
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('WARNING test_alert'))
    spy.mockRestore()
  })

  it('getHistory respects limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      am.clearDedup()
      am.emit({ type: `type_${i}`, severity: 'warning', message: `msg ${i}` })
    }
    expect(am.getHistory(3)).toHaveLength(3)
  })

  it('alert objects have id and timestamp', () => {
    am.emit({ type: 'test', severity: 'critical', message: 'x', details: { key: 'val' } })
    const a = am.getHistory()[0]
    expect(a.id).toBeTruthy()
    expect(a.timestamp).toBeTruthy()
    expect(a.details).toEqual({ key: 'val' })
  })

  it('uses zero-ms dedup window to allow rapid re-emit', async () => {
    const fast = new AlertManager({ dedupWindowMs: 0, webhookUrls: [] })
    fast.emit({ type: 'x', severity: 'warning', message: 'y' })
    await new Promise((r) => setTimeout(r, 5))
    fast.emit({ type: 'x', severity: 'warning', message: 'y' })
    expect(fast.getHistory()).toHaveLength(2)
  })
})
