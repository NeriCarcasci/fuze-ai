import { describe, it, expect } from 'vitest'
import { CircuitBreaker } from '../src/circuit-breaker.js'
import { CircuitOpenError } from '../src/errors.js'

function failingFn(): () => Promise<never> {
  return async () => {
    throw new Error('boom')
  }
}

describe('CircuitBreaker', () => {
  it('opens after threshold consecutive failures', async () => {
    const cb = new CircuitBreaker({ threshold: 3, openMs: 1000, now: () => 0 })
    for (let i = 0; i < 3; i++) {
      await expect(cb.run(failingFn())).rejects.toThrow('boom')
    }
    expect(cb.currentState).toBe('open')
  })

  it('stays open within window and refuses calls', async () => {
    let t = 0
    const cb = new CircuitBreaker({ threshold: 2, openMs: 1000, now: () => t })
    await expect(cb.run(failingFn())).rejects.toThrow('boom')
    await expect(cb.run(failingFn())).rejects.toThrow('boom')
    expect(cb.currentState).toBe('open')
    t = 500
    await expect(cb.run(async () => 'ok')).rejects.toBeInstanceOf(CircuitOpenError)
  })

  it('transitions to half-open after window elapses', async () => {
    let t = 0
    const cb = new CircuitBreaker({ threshold: 2, openMs: 1000, now: () => t })
    await expect(cb.run(failingFn())).rejects.toThrow('boom')
    await expect(cb.run(failingFn())).rejects.toThrow('boom')
    t = 1500
    expect(cb.currentState).toBe('half-open')
  })

  it('half-open closes on success', async () => {
    let t = 0
    const cb = new CircuitBreaker({ threshold: 2, openMs: 1000, now: () => t })
    await expect(cb.run(failingFn())).rejects.toThrow('boom')
    await expect(cb.run(failingFn())).rejects.toThrow('boom')
    t = 1500
    const out = await cb.run(async () => 42)
    expect(out).toBe(42)
    expect(cb.currentState).toBe('closed')
  })

  it('half-open re-opens on failure', async () => {
    let t = 0
    const cb = new CircuitBreaker({ threshold: 2, openMs: 1000, now: () => t })
    await expect(cb.run(failingFn())).rejects.toThrow('boom')
    await expect(cb.run(failingFn())).rejects.toThrow('boom')
    t = 1500
    await expect(cb.run(failingFn())).rejects.toThrow('boom')
    expect(cb.currentState).toBe('open')
  })

  it('successful runs from closed are idempotent', async () => {
    const cb = new CircuitBreaker({ threshold: 3, openMs: 1000, now: () => 0 })
    for (let i = 0; i < 5; i++) {
      const out = await cb.run(async () => i)
      expect(out).toBe(i)
    }
    expect(cb.currentState).toBe('closed')
  })
})
