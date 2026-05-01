import { describe, expect, it } from 'vitest'
import { RegexRedactionEngine } from '../src/regex-engine.js'

const engine = new RegexRedactionEngine()

describe('RegexRedactionEngine', () => {
  it('returns the input unchanged on clean text', async () => {
    const r = await engine.redact('hello world')
    expect(r.value).toBe('hello world')
    expect(r.findings).toEqual([])
    expect(r.confidence).toBe(1)
  })

  it('detects and redacts emails', async () => {
    const r = await engine.redact('contact alice@example.com please')
    expect(r.value).toBe('contact [REDACTED] please')
    expect(r.findings.find((f) => f.kind === 'email')?.count).toBe(1)
  })

  it('detects DE phone numbers', async () => {
    const r = await engine.redact('Call +49 30 901820 today')
    const hit = r.findings.find((f) => f.kind === 'phone-de' || f.kind === 'phone')
    expect(hit).toBeDefined()
    expect(typeof r.value).toBe('string')
    expect(r.value).not.toContain('901820')
  })

  it('detects FR phone numbers', async () => {
    const r = await engine.redact('Tel 01 42 86 82 00 ok')
    const hit = r.findings.find((f) => f.kind === 'phone-fr')
    expect(hit?.count).toBe(1)
  })

  it('detects Italian Codice Fiscale', async () => {
    const r = await engine.redact('CF: RSSMRA85M01H501Z fine')
    const hit = r.findings.find((f) => f.kind === 'it-codice-fiscale')
    expect(hit?.count).toBe(1)
    expect(r.value).not.toContain('RSSMRA85M01H501Z')
  })

  it('validates IBAN checksum', async () => {
    const valid = await engine.redact('IBAN DE89370400440532013000 done')
    expect(valid.findings.find((f) => f.kind === 'iban')?.count).toBe(1)
    const invalid = await engine.redact('IBAN DE00000000000000000000 fake')
    expect(invalid.findings.find((f) => f.kind === 'iban')).toBeUndefined()
  })

  it('detects IPv4 addresses', async () => {
    const r = await engine.redact('host 192.168.1.10 down')
    expect(r.findings.find((f) => f.kind === 'ipv4')?.count).toBe(1)
  })

  it('detects IPv6 addresses', async () => {
    const r = await engine.redact('addr 2001:0db8:85a3:0000:0000:8a2e:0370:7334 ok')
    expect(r.findings.find((f) => f.kind === 'ipv6')?.count).toBe(1)
  })

  it('detects MAC addresses', async () => {
    const r = await engine.redact('iface 3C:5A:B4:01:23:45 down')
    expect(r.findings.find((f) => f.kind === 'mac')?.count).toBe(1)
    expect(r.value).not.toContain('3C:5A:B4:01:23:45')
  })

  it('detects JWT tokens', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'
    const r = await engine.redact(`token: ${jwt}`)
    expect(r.findings.find((f) => f.kind === 'jwt')?.count).toBe(1)
    expect(r.value).not.toContain(jwt)
  })

  it('detects OAuth bearer tokens', async () => {
    const r = await engine.redact('Authorization: Bearer abcDEF0123456789xyz=')
    expect(r.findings.find((f) => f.kind === 'oauth-bearer')?.count).toBe(1)
  })

  it('reports finding counts and field paths but never raw values', async () => {
    const payload = { user: { email: 'bob@example.com', note: 'safe' } }
    const r = await engine.redact(payload)
    const email = r.findings.find((f) => f.kind === 'email')
    expect(email).toBeDefined()
    expect(email?.fields).toEqual(['user.email'])
    const serialized = JSON.stringify(r.findings)
    expect(serialized).not.toContain('bob@example.com')
  })

  it('walks nested arrays and records dotted paths', async () => {
    const r = await engine.redact({ users: [{ contact: 'a@b.io' }, { contact: 'c@d.io' }] })
    const email = r.findings.find((f) => f.kind === 'email')
    expect(email?.count).toBe(2)
    expect(email?.fields).toEqual(['users[0].contact', 'users[1].contact'])
  })
})
