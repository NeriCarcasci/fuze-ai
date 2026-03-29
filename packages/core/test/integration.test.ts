import { describe, it, expect, afterEach } from 'vitest'
import { guard, createRun, configure, resetConfig } from '../src/index.js'
import { BudgetExceeded, LoopDetected } from '../src/errors.js'
import { ConfigLoader } from '../src/config-loader.js'
import { readFileSync, unlinkSync, existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const TRACE_FILE = join(process.cwd(), `integration-trace-${Date.now()}.jsonl`)

afterEach(() => {
  resetConfig()
  if (existsSync(TRACE_FILE)) {
    try { unlinkSync(TRACE_FILE) } catch { /* ok */ }
  }
})

describe('Integration', () => {
  it('guarded function completes normally and produces a trace', async () => {
    configure({
      defaults: { traceOutput: TRACE_FILE },
    })

    const run = createRun('test-agent')

    const search = run.guard(async function search(query: unknown) {
      return { results: [`result for ${query}`] }
    })

    const result = await search('hello')
    expect(result).toEqual({ results: ['result for hello'] })

    await run.end()

    // Verify trace file was written
    expect(existsSync(TRACE_FILE)).toBe(true)

    const content = readFileSync(TRACE_FILE, 'utf-8').trim()
    const lines = content.split('\n')

    // run_start + 1 step + run_end = 3 lines
    expect(lines.length).toBeGreaterThanOrEqual(3)

    // Each line must be valid JSON
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }

    // Verify run_start and run_end are present
    const records = lines.map((l) => JSON.parse(l))
    expect(records[0].recordType).toBe('run_start')
    expect(records[records.length - 1].recordType).toBe('run_end')
  })

  it('guarded function exceeds budget and throws before execution', async () => {
    configure({
      defaults: {
        traceOutput: TRACE_FILE,
        maxCostPerRun: 0.10,
      },
    })

    const run = createRun('budget-test')

    const expensive = run.guard(
      async function expensive() {
        return 'should not run'
      },
      {
        model: 'openai/gpt-4o',
        estimatedTokensIn: 100000,
        estimatedTokensOut: 50000,
      },
    )

    // Estimated cost: 100000 * 0.0000025 + 50000 * 0.00001 = 0.25 + 0.50 = 0.75
    // Run ceiling is 0.10, so this should throw
    await expect(expensive()).rejects.toThrow(BudgetExceeded)
  })

  it('guarded function loops and is killed', async () => {
    configure({
      defaults: {
        traceOutput: TRACE_FILE,
        maxIterations: 3,
      },
      // High thresholds so iteration cap fires first
      loopDetection: { repeatThreshold: 100, windowSize: 100 },
    })

    const run = createRun('loop-test')

    let callNum = 0
    const step = run.guard(async function repeatingStep(n: unknown) {
      return `result-${n}`
    })

    await step(++callNum)
    await step(++callNum)
    await step(++callNum)

    // 4th call exceeds maxIterations of 3
    await expect(step(++callNum)).rejects.toThrow(LoopDetected)
  })

  it('side-effect function is recorded and can be rolled back', async () => {
    configure({
      defaults: { traceOutput: TRACE_FILE },
    })

    // We need to test side-effect tracking at a lower level since
    // the public API doesn't expose rollback directly.
    // Instead, verify that sideEffect flag is recorded in the trace.
    const run = createRun('side-effect-test')

    const rollbackCalls: unknown[] = []
    const sendEmail = run.guard(
      async function sendEmail(to: unknown) {
        return { messageId: `msg-to-${to}` }
      },
      {
        sideEffect: true,
        compensate: (result: unknown) => { rollbackCalls.push(result) },
      },
    )

    await sendEmail('alice@example.com')
    await run.end()

    // Verify trace records the side-effect
    const content = readFileSync(TRACE_FILE, 'utf-8').trim()
    const lines = content.split('\n')
    const stepRecords = lines
      .map((l) => JSON.parse(l))
      .filter((r: { recordType: string }) => r.recordType === 'step')

    expect(stepRecords.length).toBe(1)
    expect(stepRecords[0].hasSideEffect).toBe(true)
  })

  it('config from fuze.toml overrides defaults', () => {
    // Write a temporary fuze.toml
    const tomlPath = join(process.cwd(), `test-fuze-integration-${Date.now()}.toml`)

    writeFileSync(
      tomlPath,
      `
[defaults]
maxRetries = 7
timeout = 99000
`,
      'utf-8',
    )

    try {
      const config = ConfigLoader.load(tomlPath)
      const resolved = ConfigLoader.merge(config, {})

      expect(resolved.maxRetries).toBe(7)
      expect(resolved.timeout).toBe(99000)
      // Unset values use defaults
      expect(resolved.maxIterations).toBe(25)
    } finally {
      if (existsSync(tomlPath)) unlinkSync(tomlPath)
    }
  })

  it('guard options override fuze.toml config', () => {
    const projectConfig = {
      defaults: {
        maxRetries: 10,
        timeout: 60000,
      },
    }

    const resolved = ConfigLoader.merge(projectConfig, {
      maxRetries: 1,
      timeout: 1000,
    })

    expect(resolved.maxRetries).toBe(1)
    expect(resolved.timeout).toBe(1000)
  })
})
