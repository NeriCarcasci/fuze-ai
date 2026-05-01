import { describe, expect, it } from 'vitest'
import { LayeredRedactionEngine } from '../src/layered.js'
import type { Finding, RedactionEngine, RedactionResult } from '../src/types.js'

const stubEngine = (name: string, findings: readonly Finding[], confidence: number, value: unknown = 'v'): RedactionEngine => ({
  name,
  redact: async (): Promise<RedactionResult> => ({ value, findings, confidence }),
})

describe('LayeredRedactionEngine', () => {
  it('union mode includes findings flagged by any engine', async () => {
    const a = stubEngine('a', [{ kind: 'email', count: 1, fields: ['x'] }], 0.9)
    const b = stubEngine('b', [{ kind: 'person', count: 2, fields: ['y'] }], 0.6)
    const layered = new LayeredRedactionEngine({ engines: [a, b], mode: 'union' })
    const r = await layered.redact('payload')
    const kinds = r.findings.map((f) => f.kind).sort()
    expect(kinds).toEqual(['email', 'person'])
  })

  it('intersection mode only includes findings common to every engine', async () => {
    const a = stubEngine('a', [{ kind: 'email', count: 1, fields: ['x'] }, { kind: 'person', count: 1, fields: ['y'] }], 0.9)
    const b = stubEngine('b', [{ kind: 'person', count: 2, fields: ['z'] }], 0.6)
    const layered = new LayeredRedactionEngine({ engines: [a, b], mode: 'intersection' })
    const r = await layered.redact('payload')
    expect(r.findings.length).toBe(1)
    expect(r.findings[0]?.kind).toBe('person')
  })

  it('intersection takes the minimum confidence across engines', async () => {
    const a = stubEngine('a', [], 0.9)
    const b = stubEngine('b', [], 0.4)
    const layered = new LayeredRedactionEngine({ engines: [a, b], mode: 'intersection' })
    const r = await layered.redact('p')
    expect(r.confidence).toBe(0.4)
  })

  it('union takes the maximum confidence across engines', async () => {
    const a = stubEngine('a', [], 0.3)
    const b = stubEngine('b', [], 0.95)
    const layered = new LayeredRedactionEngine({ engines: [a, b], mode: 'union' })
    const r = await layered.redact('p')
    expect(r.confidence).toBe(0.95)
  })
})
