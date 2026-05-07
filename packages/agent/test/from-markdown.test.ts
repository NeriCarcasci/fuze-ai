import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fromMarkdown, concatenateContext } from '../src/agent/from-markdown.js'

let tmp: string

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'fuze-fm-'))
  writeFileSync(join(tmp, 'instructions.md'), '# Be helpful\nAnswer concisely.\n')
  mkdirSync(join(tmp, 'context'))
  writeFileSync(join(tmp, 'context', '01-tone.md'), 'Tone: formal.\n')
  writeFileSync(join(tmp, 'context', '02-policy.md'), 'Policy: cite sources.\n')
  writeFileSync(join(tmp, 'context', 'unrelated.txt'), 'should be skipped\n')
})

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('fromMarkdown', () => {
  it('reads and hashes a single file', () => {
    const r = fromMarkdown(join(tmp, 'instructions.md'))
    expect(r.resolved).toContain('Be helpful')
    expect(r.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(r.bytes).toBeGreaterThan(0)
  })

  it('produces stable hashes across reads', () => {
    const a = fromMarkdown(join(tmp, 'instructions.md'))
    const b = fromMarkdown(join(tmp, 'instructions.md'))
    expect(a.sha256).toBe(b.sha256)
  })

  it('reads a directory in lex order, skipping non-markdown', () => {
    const d = fromMarkdown.dir(join(tmp, 'context'))
    expect(d.files).toHaveLength(2)
    expect(d.files[0]!.path.endsWith('01-tone.md')).toBe(true)
    expect(d.files[1]!.path.endsWith('02-policy.md')).toBe(true)
    expect(d.concatenatedHash).toMatch(/^[a-f0-9]{64}$/)
  })

  it('throws when dir target is not a directory', () => {
    expect(() => fromMarkdown.dir(join(tmp, 'instructions.md'))).toThrow(/not a directory/)
  })

  it('concatenateContext emits provenance comments', () => {
    const d = fromMarkdown.dir(join(tmp, 'context'))
    const text = concatenateContext(d)
    expect(text).toContain('01-tone.md')
    expect(text).toContain('02-policy.md')
    expect(text).toContain('Tone: formal')
    expect(text).toContain('Policy: cite sources')
  })
})
