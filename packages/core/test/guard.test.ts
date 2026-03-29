import { describe, it, expect, vi, afterEach } from 'vitest'
import { guard, createRun, configure, resetConfig } from '../src/index.js'
import { LoopDetected, BudgetExceeded, GuardTimeout } from '../src/errors.js'
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

/** Read the first step record from the trace file (after flushing via run.end()). */
async function readFirstStep(): Promise<Record<string, unknown>> {
  const trace = readFileSync(TRACE_FILE, 'utf-8')
  const lines = trace.trim().split('\n').map(l => JSON.parse(l) as Record<string, unknown>)
  const step = lines.find(r => r.recordType === 'step')
  if (!step) throw new Error('No step record found in trace')
  return step
}

describe('auto cost extraction', () => {
  it('extracts actual cost from OpenAI-shaped response (usage.prompt_tokens)', async () => {
    const run = createRun('test')
    const fn = run.guard(
      async function callLLM() {
        return {
          model: 'openai/gpt-4o',
          usage: { prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 },
        }
      },
      { model: 'openai/gpt-4o' },
    )

    await fn()
    await run.end()

    const step = await readFirstStep()
    expect(step.tokensIn).toBe(1000)
    expect(step.tokensOut).toBe(500)
    expect(step.costUsd).toBeGreaterThan(0)
  })

  it('extracts actual cost from Anthropic-shaped response (usage.input_tokens)', async () => {
    const run = createRun('test')
    const fn = run.guard(
      async function callAnthropic() {
        return {
          model: 'claude-opus-4-6',
          usage: { input_tokens: 800, output_tokens: 400 },
        }
      },
      { model: 'anthropic/claude-opus-4-6' },
    )

    await fn()
    await run.end()

    const step = await readFirstStep()
    expect(step.tokensIn).toBe(800)
    expect(step.tokensOut).toBe(400)
  })

  it('uses custom costExtractor when provided', async () => {
    const run = createRun('test')
    const fn = run.guard(
      async function callCustom() {
        return { meta: { in: 300, out: 150 } }
      },
      {
        model: 'openai/gpt-4o',
        costExtractor: (result) => {
          const r = result as { meta: { in: number; out: number } }
          return { tokensIn: r.meta.in, tokensOut: r.meta.out }
        },
      },
    )

    await fn()
    await run.end()

    const step = await readFirstStep()
    expect(step.tokensIn).toBe(300)
    expect(step.tokensOut).toBe(150)
  })

  it('falls back to pre-flight estimate when result has no usage data', async () => {
    const run = createRun('test')
    const fn = run.guard(
      async function noUsage() {
        return { data: 'plain result, no usage' }
      },
      { model: 'openai/gpt-4o', estimatedTokensIn: 100, estimatedTokensOut: 50 },
    )

    await fn()
    await run.end()

    const step = await readFirstStep()
    expect(step.tokensIn).toBe(100)
    expect(step.tokensOut).toBe(50)
  })

  it('works without model specified — tracks steps but skips cost', async () => {
    const run = createRun('test')
    const fn = run.guard(async function noCost() {
      return 'plain string result'
    })

    await expect(fn()).resolves.toBe('plain string result')
    await run.end()
  })

  it('backward compat: estimatedTokensIn/Out still work for pre-flight check', async () => {
    configure({ defaults: { maxCostPerRun: 0.0001 } })

    const run = createRun('test')
    const fn = run.guard(
      async function expensive() { return null },
      { model: 'openai/gpt-4o', estimatedTokensIn: 10_000_000, estimatedTokensOut: 5_000_000 },
    )

    await expect(fn()).rejects.toThrow(BudgetExceeded)
  })

  it('auto pre-flight estimate blocks obviously over-budget calls', async () => {
    configure({ defaults: { maxCostPerRun: 0.000001 } })

    const run = createRun('test')
    const fn = run.guard(
      async function hugeArgs(data: unknown) { return data },
      { model: 'openai/gpt-4o' },
    )
    const bigPayload = 'x'.repeat(100_000)

    await expect(fn(bigPayload)).rejects.toThrow(BudgetExceeded)
  })

  it('global costExtractor via configure() applies to all guard calls', async () => {
    configure({
      costExtractor: () => ({ tokensIn: 999, tokensOut: 111 }),
    })

    const run = createRun('test')
    const fn = run.guard(async function withGlobal() {
      return { anything: true }
    })

    await fn()
    await run.end()

    const step = await readFirstStep()
    expect(step.tokensIn).toBe(999)
    expect(step.tokensOut).toBe(111)
  })
})
