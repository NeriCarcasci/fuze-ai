import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { configure, resetConfig, run, span } from '../src/index.js'
import type { SpanRole, StepContent } from '../src/index.js'

const TRACE_FILE = join(process.cwd(), `test-span-roles-${Date.now()}.jsonl`)

afterEach(() => {
  resetConfig()
  if (existsSync(TRACE_FILE)) {
    try { unlinkSync(TRACE_FILE) } catch { /* ok */ }
  }
})

interface Case {
  role: SpanRole
  content: StepContent
}

const cases: Case[] = [
  { role: 'user', content: { kind: 'text', text: 'hello' } },
  { role: 'assistant', content: { kind: 'text', text: 'hi there' } },
  { role: 'system', content: { kind: 'text', text: 'you are helpful' } },
  { role: 'tool', content: { kind: 'tool_call', args: [1, 2], result: 3 } },
  {
    role: 'llm',
    content: { kind: 'messages', messages: [{ role: 'user', text: 'q' }] },
  },
  {
    role: 'retrieval',
    content: {
      kind: 'retrieval',
      query: 'what is gdpr',
      results: [{ docId: 'd1', chunkId: 'c1', score: 0.92 }],
    },
  },
]

describe('span roles', () => {
  for (const c of cases) {
    it(`emits a ${c.role} span with content that round-trips`, async () => {
      configure({ defaults: { traceOutput: TRACE_FILE } })

      await run({}, async () => {
        await span({ role: c.role, capture: 'full', content: c.content })
      })

      const lines = readFileSync(TRACE_FILE, 'utf-8').trim().split('\n').map((l) => JSON.parse(l))
      const stepEntry = lines.find((l) => l.recordType === 'step')
      expect(stepEntry).toBeDefined()
      expect(stepEntry.role).toBe(c.role)
      expect(stepEntry.capture).toBe('full')
      expect(stepEntry.content).toEqual(c.content)
    })
  }
})
