import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { TraceRecorder, verifyChain } from '../src/trace-recorder.js'
import type { TraceEntry } from '../src/trace-recorder.js'
import { readFileSync, unlinkSync, existsSync, mkdtempSync, statSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'

const TEST_TRACE_FILE = join(process.cwd(), `test-trace-${Date.now()}.jsonl`)

describe('TraceRecorder', () => {
  let recorder: TraceRecorder

  beforeEach(() => {
    recorder = new TraceRecorder(TEST_TRACE_FILE)
  })

  afterEach(() => {
    vi.restoreAllMocks()
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
        tokensIn: 100,
        tokensOut: 50,
        latencyMs: 100,
      })
    }

    recorder.endRun(runId, 'completed')
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
      tokensIn: 200,
      tokensOut: 100,
      latencyMs: 50,
    })

    recorder.endRun(runId, 'completed')
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
    recorder.endRun(runId, 'completed')
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

    recorder.endRun(runId, 'killed')
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

  it('creates hash chain and signature fields for each entry', async () => {
    const runId = randomUUID()
    recorder.startRun(runId, 'chain-agent', { timeout: 30000 })

    for (let i = 1; i <= 3; i++) {
      recorder.recordStep({
        stepId: randomUUID(),
        runId,
        stepNumber: i,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        toolName: `tool-${i}`,
        argsHash: 'chain-hash',
        hasSideEffect: false,
        tokensIn: 10,
        tokensOut: 5,
        latencyMs: 20,
      })
    }

    recorder.endRun(runId, 'completed')
    await recorder.flush()

    const entries = readFileSync(TEST_TRACE_FILE, 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { hash?: string; prevHash?: string; signature?: string })

    expect(entries.length).toBe(5)
    expect(entries[0].prevHash).toBe('0'.repeat(64))

    for (let i = 0; i < entries.length; i++) {
      expect(entries[i].hash).toMatch(/^[a-f0-9]{64}$/)
      expect(entries[i].prevHash).toMatch(/^[a-f0-9]{64}$/)
      expect(entries[i].signature).toMatch(/^[a-f0-9]{64}$/)
      if (i > 0) {
        expect(entries[i].prevHash).toBe(entries[i - 1].hash)
      }
    }
  })

  it('detects data tampering via hash verification', async () => {
    const runId = randomUUID()
    recorder.startRun(runId, 'tamper-agent', {})
    for (let i = 0; i < 8; i++) {
      recorder.recordStep({
        stepId: randomUUID(),
        runId,
        stepNumber: i + 1,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        toolName: `tool-${i + 1}`,
        argsHash: 'hash',
        hasSideEffect: false,
        tokensIn: 10,
        tokensOut: 5,
        latencyMs: 10,
      })
    }
    recorder.endRun(runId, 'completed')
    await recorder.flush()

    const entries = readFileSync(TEST_TRACE_FILE, 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    entries[5].toolName = 'tampered-tool-name'
    const result = verifyChain(entries as TraceEntry[])

    expect(result.valid).toBe(false)
    expect(result.firstInvalidIndex).toBe(5)
  })

  it('detects HMAC tampering while hash chain remains valid', async () => {
    const runId = randomUUID()
    recorder.startRun(runId, 'sig-agent', {})
    for (let i = 0; i < 8; i++) {
      recorder.recordStep({
        stepId: randomUUID(),
        runId,
        stepNumber: i + 1,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        toolName: `tool-${i + 1}`,
        argsHash: 'hash',
        hasSideEffect: false,
        tokensIn: 10,
        tokensOut: 5,
        latencyMs: 10,
      })
    }
    recorder.endRun(runId, 'completed')
    await recorder.flush()

    const entries = readFileSync(TEST_TRACE_FILE, 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    entries[5].signature = 'f'.repeat(64)
    const result = verifyChain(entries as TraceEntry[])

    expect(result.valid).toBe(true)
    expect(result.hmacValid).toBe(false)
    expect(result.firstInvalidIndex).toBe(5)
  })

  it('skips legacy entries without hash/signature and verifies signed entries', async () => {
    const runId = randomUUID()
    recorder.startRun(runId, 'legacy-agent', {})
    for (let i = 0; i < 8; i++) {
      recorder.recordStep({
        stepId: randomUUID(),
        runId,
        stepNumber: i + 1,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        toolName: `tool-${i + 1}`,
        argsHash: 'hash',
        hasSideEffect: false,
        tokensIn: 10,
        tokensOut: 5,
        latencyMs: 10,
      })
    }
    recorder.endRun(runId, 'completed')
    await recorder.flush()

    const entries = readFileSync(TEST_TRACE_FILE, 'utf-8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>)

    for (let i = 0; i < 5; i++) {
      delete entries[i].hash
      delete entries[i].prevHash
      delete entries[i].signature
      delete entries[i].sequence
    }

    expect(verifyChain(entries as TraceEntry[])).toEqual({ valid: true, hmacValid: true })
  })

  it('creates ~/.fuze/audit.key with 32 bytes and secure permissions', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'fuze-home-'))
    const keyPath = join(fakeHome, '.fuze', 'audit.key')
    const previousPath = process.env['FUZE_AUDIT_KEY_PATH']
    process.env['FUZE_AUDIT_KEY_PATH'] = keyPath
    try {
      const localRecorder = new TraceRecorder(TEST_TRACE_FILE)
      localRecorder.startRun(randomUUID(), 'key-agent', {})
      expect(existsSync(keyPath)).toBe(true)
      const stats = statSync(keyPath)
      expect(stats.size).toBe(32)
      if (process.platform !== 'win32') {
        expect(stats.mode & 0o777).toBe(0o600)
      }
    } finally {
      rmSync(fakeHome, { recursive: true, force: true })
      if (previousPath) {
        process.env['FUZE_AUDIT_KEY_PATH'] = previousPath
      } else {
        delete process.env['FUZE_AUDIT_KEY_PATH']
      }
    }
  })

  it('reuses the same key across TraceRecorder instances', () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'fuze-home-'))
    const keyPath = join(fakeHome, '.fuze', 'audit.key')
    const previousPath = process.env['FUZE_AUDIT_KEY_PATH']
    process.env['FUZE_AUDIT_KEY_PATH'] = keyPath
    try {
      const runId = 'same-run'
      const stepTemplate = {
        stepId: 'same-step',
        runId,
        stepNumber: 1,
        startedAt: '2026-01-01T00:00:00.000Z',
        endedAt: '2026-01-01T00:00:00.100Z',
        toolName: 'same-tool',
        argsHash: 'same-args',
        hasSideEffect: false,
        tokensIn: 10,
        tokensOut: 5,
        latencyMs: 10,
      }

      const recorderA = new TraceRecorder(TEST_TRACE_FILE)
      recorderA.recordStep(stepTemplate)
      const sigA = recorderA.getBuffer()[0]?.signature

      const recorderB = new TraceRecorder(TEST_TRACE_FILE)
      recorderB.recordStep(stepTemplate)
      const sigB = recorderB.getBuffer()[0]?.signature

      expect(sigA).toBeDefined()
      expect(sigA).toBe(sigB)
    } finally {
      rmSync(fakeHome, { recursive: true, force: true })
      if (previousPath) {
        process.env['FUZE_AUDIT_KEY_PATH'] = previousPath
      } else {
        delete process.env['FUZE_AUDIT_KEY_PATH']
      }
    }
  })
})
