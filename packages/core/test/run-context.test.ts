import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { configure, resetConfig, run, span, traced, getCurrentRunContext } from '../src/index.js'
import { FuzeError } from '../src/errors.js'

const TRACE_FILE = join(process.cwd(), `test-run-context-${Date.now()}.jsonl`)

afterEach(() => {
  resetConfig()
  if (existsSync(TRACE_FILE)) {
    try { unlinkSync(TRACE_FILE) } catch { /* ok */ }
  }
})

describe('run context', () => {
  it('propagates across await boundaries', async () => {
    configure({ defaults: { traceOutput: TRACE_FILE } })

    let runIdInside: string | undefined
    let runIdAfterAwait: string | undefined

    await run({}, async () => {
      runIdInside = getCurrentRunContext()?.runId
      await new Promise((r) => setTimeout(r, 5))
      runIdAfterAwait = getCurrentRunContext()?.runId
    })

    expect(runIdInside).toBeDefined()
    expect(runIdAfterAwait).toBe(runIdInside)
  })

  it('links nested traced() calls via parentStepId', async () => {
    configure({ defaults: { traceOutput: TRACE_FILE } })

    const innerFn = traced(async () => 'inner-result', {
      role: 'tool',
      toolName: 'inner',
    })

    const outerFn = traced(async () => innerFn(), {
      role: 'tool',
      toolName: 'outer',
    })

    await run({}, async () => {
      await outerFn()
    })

    const lines = readFileSync(TRACE_FILE, 'utf-8').trim().split('\n').map((l) => JSON.parse(l))
    const steps = lines.filter((l) => l.recordType === 'step')
    expect(steps.length).toBe(2)

    const innerStep = steps.find((s) => s.toolName === 'inner')
    const outerStep = steps.find((s) => s.toolName === 'outer')
    expect(innerStep).toBeDefined()
    expect(outerStep).toBeDefined()
    expect(outerStep.parentStepId).toBeUndefined()
    expect(innerStep.parentStepId).toBe(outerStep.stepId)
  })

  it('throws when span() is called outside run()', async () => {
    configure({ defaults: { traceOutput: TRACE_FILE } })
    await expect(
      span({ role: 'user', capture: 'hash' }),
    ).rejects.toThrow(FuzeError)
  })

  it('throws when traced() is invoked outside run()', () => {
    configure({ defaults: { traceOutput: TRACE_FILE } })
    const wrapped = traced(async () => 1, { role: 'tool', toolName: 'orphan' })
    expect(() => wrapped()).toThrow(FuzeError)
  })
})
