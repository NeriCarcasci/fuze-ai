import { describe, it, expect, vi, afterEach } from 'vitest'
import { guard, createRun, configure, resetConfig } from '../src/index.js'
import { LoopDetected, GuardTimeout } from '../src/errors.js'
import { unlinkSync, existsSync, readFileSync } from 'node:fs'

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

  it('clears timeout timer on normal completion and leaves no pending timers', async () => {
    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    try {
      const run = createRun('timer-clean', { timeout: 5000 })
      const fast = run.guard(async function fast() {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return 'done'
      })

      const execution = fast()
      await vi.advanceTimersByTimeAsync(10)

      await expect(execution).resolves.toBe('done')
      expect(clearTimeoutSpy).toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      clearTimeoutSpy.mockRestore()
      vi.useRealTimers()
    }
  })

  it('throws GuardTimeout with timeoutMs and function name in message', async () => {
    vi.useFakeTimers()
    try {
      const run = createRun('timeout-test', { timeout: 100 })
      const slow = run.guard(async function slowWorker() {
        await new Promise((resolve) => setTimeout(resolve, 500))
        return 'never'
      })

      const execution = slow()
      const captured = execution.catch((err) => err)
      await vi.advanceTimersByTimeAsync(100)

      const caught = await captured

      expect(caught).toBeInstanceOf(GuardTimeout)
      const timeoutError = caught as GuardTimeout
      expect(timeoutError.timeoutMs).toBe(100)
      expect(timeoutError.message).toContain('slowWorker')

      await vi.runAllTimersAsync()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('retries retryable errors and succeeds on the second attempt', async () => {
    vi.useFakeTimers()
    try {
      const run = createRun('retry-success', { maxRetries: 2 })
      let attempts = 0
      const flaky = run.guard(async function flaky() {
        attempts += 1
        if (attempts === 1) {
          throw new Error('transient failure')
        }
        return 'ok'
      })

      const execution = flaky()
      await vi.advanceTimersByTimeAsync(100)
      await expect(execution).resolves.toBe('ok')
      expect(attempts).toBe(2)
    } finally {
      vi.useRealTimers()
    }
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

  it('does not leak timers across high-volume successful calls', async () => {
    configure({
      loopDetection: {
        repeatThreshold: 2001,
        windowSize: 2001,
      },
    })

    const run = createRun('load-test', { timeout: 1000, maxIterations: 2001, onLoop: 'warn' })
    const fast = run.guard(async function fastUnderLoad() {
      return 'ok'
    })

    const baselineHandles = countTimeoutHandles()
    for (let i = 0; i < 1000; i++) {
      await fast()
    }
    const afterHandles = countTimeoutHandles()

    expect(afterHandles).toBe(baselineHandles)
  })

  it('avoids unhandled rejections from timed-out functions that reject later', async () => {
    vi.useFakeTimers()
    const unhandledRejection = vi.fn()
    process.on('unhandledRejection', unhandledRejection)

    try {
      const run = createRun('late-rejection', { timeout: 50 })
      const fn = run.guard(async function lateReject() {
        await new Promise((_, reject) => setTimeout(() => reject(new Error('late failure')), 200))
      })

      const execution = fn()
      const timeoutPromise = execution.catch((err) => err)
      await vi.advanceTimersByTimeAsync(50)
      const timeoutError = await timeoutPromise
      expect(timeoutError).toBeInstanceOf(GuardTimeout)

      await vi.advanceTimersByTimeAsync(200)
      await Promise.resolve()
      expect(unhandledRejection).not.toHaveBeenCalled()
    } finally {
      process.removeListener('unhandledRejection', unhandledRejection)
      vi.useRealTimers()
    }
  })

  it('assigns unique step numbers when guarded calls run concurrently', async () => {
    configure({
      defaults: { traceOutput: TRACE_FILE },
    })

    const run = createRun('parallel-run')
    const step = run.guard(async function parallelStep(delay: unknown) {
      await new Promise((resolve) => setTimeout(resolve, delay as number))
      return delay
    })

    await Promise.all([step(20), step(5), step(1)])
    await run.end()

    const stepRecords = readStepRecords()
    const stepNumbers = stepRecords.map((record) => Number(record['stepNumber']))

    expect(stepNumbers).toHaveLength(3)
    expect(new Set(stepNumbers).size).toBe(3)
    expect([...stepNumbers].sort((a, b) => a - b)).toEqual([1, 2, 3])
  })
})

function readStepRecords(): Record<string, unknown>[] {
  const trace = readFileSync(TRACE_FILE, 'utf-8')
  return trace
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .filter((record) => record['recordType'] === 'step')
}

function countTimeoutHandles(): number {
  const proc = process as NodeJS.Process & { _getActiveHandles?: () => unknown[] }
  if (!proc._getActiveHandles) return 0

  return proc
    ._getActiveHandles()
    .filter((handle) => {
      if (!handle || typeof handle !== 'object') return false
      const ctor = (handle as { constructor?: { name?: string } }).constructor
      return ctor?.name === 'Timeout'
    })
    .length
}

