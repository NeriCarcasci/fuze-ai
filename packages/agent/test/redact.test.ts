import { describe, expect, it } from 'vitest'
import { redact, redactString } from '../src/evidence/redact.js'

describe('redact', () => {
  it('redacts OpenAI-style API keys in strings', () => {
    expect(redactString('key=sk-abcdefghijklmnopqrstuvwxyz')).toContain('<<fuze:secret:redacted>>')
  })

  it('redacts Bearer tokens in strings', () => {
    const out = redactString('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.aaa.bbb')
    expect(out).toContain('<<fuze:secret:redacted>>')
  })

  it('redacts AWS access keys in strings', () => {
    const out = redactString('AWS_ACCESS_KEY=AKIA1234567890ABCDEF')
    expect(out).toContain('<<fuze:secret:redacted>>')
  })

  it('redacts SecretRef-branded objects', () => {
    const v = { token: { __brand: 'SecretRef', id: 'mistral-key' } }
    const out = redact(v) as Record<string, unknown>
    expect(out['token']).toBe('<<fuze:secret:redacted>>')
  })

  it('walks nested structures', () => {
    const v = { a: ['sk-' + 'x'.repeat(40), { b: 'normal' }] }
    const out = JSON.stringify(redact(v))
    expect(out).toContain('<<fuze:secret:redacted>>')
    expect(out).toContain('normal')
  })

  it('passes booleans and numbers through', () => {
    expect(redact(42)).toBe(42)
    expect(redact(true)).toBe(true)
    expect(redact(null)).toBe(null)
  })
})
