import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { TraceRecorder } from '../src/trace-recorder.js'
import { readFileSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const TEST_TRACE_FILE = join(process.cwd(), `test-trace-${Date.now()}.jsonl`)

describe('TraceRecorder', () => {
  let recorder: TraceRecorder

  beforeEach(() => {
    recorder = new TraceRecorder(TEST_TRACE_FILE)
  })

  afterEach(() => {
    if (existsSync(TEST_TRACE_FILE)) {
      unlinkSync(TEST_TRACE_FILE)
    }
  })

  it('produces correct number of JSONL lines for a 5-step run', async () => {
    const runId = randomUUID()
    recorder.startRun(runId, 'test-agent', { timeout: 30000 })

    for (let i = 1; i <= 5; i++) {
      recorder.recordStep({
        stepId: randomUUID(),
        runId,
        stepNumber: i,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        toolName: `tool-${i}`,
        argsHash: 'abc123',
        hasSideEffect: false,
        costUsd: 0.01,
        tokensIn: 100,
        tokensOut: 50,
        latencyMs: 100,
      })
    }

    recorder.endRun(runId, 'completed', 0.05)
    await recorder.flush()

    const content = readFileSync(TEST_TRACE_FILE, 'utf-8').trim()
    const lines = content.split('\n')

    // 1 run_start + 5 steps + 1 run_end = 7 lines
    expect(lines).toHaveLength(7)
  })

  it('writes valid JSON on each line', async () => {
    const runId = randomUUID()
    recorder.startRun(runId, 'test-agent', {})

    recorder.recordStep({
      stepId: randomUUID(),
      runId,
      stepNumber: 1,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      toolName: 'search',
      argsHash: 'def456',
      hasSideEffect: false,
      costUsd: 0.02,
      tokensIn: 200,
      tokensOut: 100,
      latencyMs: 50,
    })

    recorder.endRun(runId, 'completed', 0.02)
    await recorder.flush()

    const content = readFileSync(TEST_TRACE_FILE, 'utf-8').trim()
    const lines = content.split('\n')

    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow()
    }
  })

  it('writes valid ISO 8601 timestamps', async () => {
    const runId = randomUUID()
    recorder.startRun(runId, 'test-agent', {})
    recorder.endRun(runId, 'completed', 0)
    await recorder.flush()

    const content = readFileSync(TEST_TRACE_FILE, 'utf-8').trim()
    const lines = content.split('\n')
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

    for (const line of lines) {
      const parsed = JSON.parse(line)
      if (parsed.timestamp) {
        expect(parsed.timestamp).toMatch(isoRegex)
      }
      if (parsed.startedAt) {
        expect(parsed.startedAt).toMatch(isoRegex)
      }
    }
  })

  it('interleaves guard events at the correct position', async () => {
    const runId = randomUUID()
    recorder.startRun(runId, 'test-agent', {})

    recorder.recordStep({
      stepId: 'step-1',
      runId,
      stepNumber: 1,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      toolName: 'search',
      argsHash: 'abc',
      hasSideEffect: false,
      costUsd: 0.01,
      tokensIn: 100,
      tokensOut: 50,
      latencyMs: 50,
    })

    recorder.recordGuardEvent({
      eventId: randomUUID(),
      runId,
      stepId: 'step-2',
      timestamp: new Date().toISOString(),
      type: 'loop_detected',
      severity: 'critical',
      details: { type: 'max_iterations' },
    })

    recorder.endRun(runId, 'killed', 0.01)
    await recorder.flush()

    const content = readFileSync(TEST_TRACE_FILE, 'utf-8').trim()
    const lines = content.split('\n')

    expect(lines).toHaveLength(4) // run_start, step, guard_event, run_end

    const types = lines.map((l) => JSON.parse(l).recordType)
    expect(types).toEqual(['run_start', 'step', 'guard_event', 'run_end'])
  })

  it('clears buffer after flush', async () => {
    recorder.startRun(randomUUID(), 'test', {})
    expect(recorder.pendingCount).toBe(1)

    await recorder.flush()
    expect(recorder.pendingCount).toBe(0)
  })

  it('does nothing when flushing empty buffer', async () => {
    await recorder.flush()
    expect(existsSync(TEST_TRACE_FILE)).toBe(false)
  })
})
