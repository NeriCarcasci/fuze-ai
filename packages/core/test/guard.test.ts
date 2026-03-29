import { describe, it, expect, vi, afterEach } from 'vitest'
import { guard, createRun, configure, resetConfig } from '../src/index.js'
import { LoopDetected, BudgetExceeded, GuardTimeout } from '../src/errors.js'
import { unlinkSync, existsSync } from 'node:fs'

const TRACE_FILE = './fuze-traces.jsonl'

afterEach(() => {
  resetConfig()
  if (existsSync(TRACE_FILE)) {
    try { unlinkSync(TRACE_FILE) } catch { /* ok */ }
  }
})

describe('guard()', () => {
  it('wraps a sync function and returns its result', async () => {
    const add = guard(function add(a: unknown, b: unknown) {
      return (a as number) + (b as number)
    })

    const result = await add(2, 3)
    expect(result).toBe(5)
  })

  it('wraps an async function and returns its result', async () => {
    const fetchData = guard(async function fetchData(query: unknown) {
      return { results: [query] }
    })

    const result = await fetchData('test')
    expect(result).toEqual({ results: ['test'] })
  })

  it('preserves function name', () => {
    const myFunc = guard(function mySpecialFunction() { return 1 })
    expect(myFunc.name).toBe('mySpecialFunction')
  })

  it('throws GuardTimeout when function exceeds timeout', async () => {
    const slow = guard(
      async function slowFn() {
        return new Promise((resolve) => setTimeout(resolve, 500))
      },
      { timeout: 50 },
    )

    await expect(slow()).rejects.toThrow(GuardTimeout)
  })

  it('throws LoopDetected after exceeding maxIterations', async () => {
    // Use high repeat threshold so iteration cap fires first
    configure({
      loopDetection: { repeatThreshold: 100, windowSize: 100 },
    })
    const run = createRun('test', { maxIterations: 3 })

    let callNum = 0
    const step = run.guard(async function step(n: unknown) {
      return `result-${n}`
    })

    await step(++callNum)
    await step(++callNum)
    await step(++callNum)

    // 4th call exceeds cap of 3
    await expect(step(++callNum)).rejects.toThrow(LoopDetected)
  })

  it('cleans up timeout timer on successful execution', async () => {
    vi.useFakeTimers()
    const run = createRun('test', { timeout: 5000 })
    const fast = run.guard(async function fast() {
      return 'done'
    })

    const promise = fast()
    await vi.runAllTimersAsync()
    const result = await promise

    expect(result).toBe('done')
    expect(vi.getTimerCount()).toBe(0)
    vi.useRealTimers()
  })
})
