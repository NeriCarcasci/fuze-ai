import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { configure, resetConfig, run, traced } from '../src/index.js'

const TRACE_FILE = join(process.cwd(), `test-traced-${Date.now()}.jsonl`)

afterEach(() => {
  resetConfig()
  if (existsSync(TRACE_FILE)) {
    try { unlinkSync(TRACE_FILE) } catch { /* ok */ }
  }
})

function readSteps() {
  return readFileSync(TRACE_FILE, 'utf-8')
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
    .filter((l) => l.recordType === 'step')
}

describe('traced()', () => {
  it('wraps a sync function and records args + result', async () => {
    configure({ defaults: { traceOutput: TRACE_FILE } })

    const adder = traced((a: number, b: number) => a + b, {
      role: 'tool',
      capture: 'full',
      toolName: 'add',
    })

    await run({}, async () => {
      const result = adder(2, 3)
      expect(result).toBe(5)
    })

    const steps = readSteps()
    expect(steps.length).toBe(1)
    expect(steps[0].toolName).toBe('add')
    expect(steps[0].role).toBe('tool')
    expect(steps[0].content).toEqual({ kind: 'tool_call', args: [2, 3], result: 5 })
    expect(typeof steps[0].latencyMs).toBe('number')
  })

  it('wraps an async function and records args + result', async () => {
    configure({ defaults: { traceOutput: TRACE_FILE } })

    const fetcher = traced(async (q: string) => {
      await new Promise((r) => setTimeout(r, 5))
      return { q }
    }, { role: 'tool', capture: 'full', toolName: 'fetchIt' })

    await run({}, async () => {
      const result = await fetcher('hello')
      expect(result).toEqual({ q: 'hello' })
    })

    const steps = readSteps()
    expect(steps.length).toBe(1)
    expect(steps[0].content).toEqual({ kind: 'tool_call', args: ['hello'], result: { q: 'hello' } })
    expect(steps[0].latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('sets error field and omits result when wrapped fn throws', async () => {
    configure({ defaults: { traceOutput: TRACE_FILE } })

    const boom = traced(async () => {
      throw new Error('nope')
    }, { role: 'tool', capture: 'full', toolName: 'boom' })

    await run({}, async () => {
      await expect(boom()).rejects.toThrow('nope')
    })

    const steps = readSteps()
    expect(steps.length).toBe(1)
    expect(steps[0].error).toBe('nope')
    expect(steps[0].content?.result).toBeUndefined()
  })
})
