import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { configure, resetConfig, run, span } from '../src/index.js'
import type { Redactor, StepContent } from '../src/index.js'
import { FuzeError } from '../src/errors.js'

const TRACE_FILE = join(process.cwd(), `test-redaction-${Date.now()}.jsonl`)

afterEach(() => {
  resetConfig()
  if (existsSync(TRACE_FILE)) {
    try { unlinkSync(TRACE_FILE) } catch { /* ok */ }
  }
})

const starRedactor: Redactor = {
  redactContent(content: StepContent): StepContent {
    if (content.kind === 'text') return { kind: 'text', text: '***' }
    if (content.kind === 'messages') {
      return { kind: 'messages', messages: content.messages.map((m) => ({ role: m.role, text: '***' })) }
    }
    if (content.kind === 'tool_call') {
      return { kind: 'tool_call', args: '***', result: content.result === undefined ? undefined : '***' }
    }
    return { kind: 'retrieval', query: '***', results: content.results.map((r) => ({ ...r, snippet: '***' })) }
  },
}

describe('redaction capture', () => {
  it('redacts content when capture=full+redact', async () => {
    configure({ defaults: { traceOutput: TRACE_FILE }, redactor: starRedactor })

    const secret = 'super-secret-pii'
    await run({}, async () => {
      await span({ role: 'user', capture: 'full+redact', content: { kind: 'text', text: secret } })
    })

    const lines = readFileSync(TRACE_FILE, 'utf-8').trim().split('\n').map((l) => JSON.parse(l))
    const stepEntry = lines.find((l) => l.recordType === 'step')
    expect(stepEntry).toBeDefined()
    expect(stepEntry.content).toEqual({ kind: 'text', text: '***' })

    const raw = readFileSync(TRACE_FILE, 'utf-8')
    expect(raw.includes(secret)).toBe(false)
  })

  it('throws when capture=full+redact and no redactor is configured', async () => {
    configure({ defaults: { traceOutput: TRACE_FILE } })

    await expect(
      run({}, async () => {
        await span({ role: 'user', capture: 'full+redact', content: { kind: 'text', text: 'x' } })
      }),
    ).rejects.toThrow(FuzeError)
  })
})
