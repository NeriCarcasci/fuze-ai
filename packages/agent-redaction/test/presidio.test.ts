import { describe, expect, it } from 'vitest'
import { FakeSidecarTransport, PresidioSidecarEngine } from '../src/presidio.js'
import type { JsonRpcRequest, JsonRpcResponse } from '../src/presidio.js'

describe('PresidioSidecarEngine', () => {
  it('roundtrips a request and decodes findings', async () => {
    const transport = new FakeSidecarTransport((req: JsonRpcRequest): JsonRpcResponse => ({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        value: '[REDACTED]',
        findings: [{ kind: 'person', count: 1, fields: ['name'] }],
        confidence: 0.85,
      },
    }))
    const engine = new PresidioSidecarEngine({ transport })
    const r = await engine.redact({ name: 'Alice' })
    expect(r.value).toBe('[REDACTED]')
    expect(r.findings).toEqual([{ kind: 'person', count: 1, fields: ['name'] }])
    expect(r.confidence).toBe(0.85)
  })

  it('fails closed on sidecar timeout', async () => {
    const transport = new FakeSidecarTransport(
      () => new Promise<JsonRpcResponse>(() => undefined),
    )
    const engine = new PresidioSidecarEngine({ transport, timeoutMs: 20 })
    const r = await engine.redact('payload')
    expect(r.confidence).toBe(0)
    expect(r.findings.length).toBe(1)
    const f = r.findings[0]
    expect(f).toBeDefined()
    expect(f?.kind).toBe('classifier-error')
  })

  it('fails closed on JSON-RPC error envelope', async () => {
    const transport = new FakeSidecarTransport((req): JsonRpcResponse => ({
      jsonrpc: '2.0',
      id: req.id,
      error: { code: -32700, message: 'parse error' },
    }))
    const engine = new PresidioSidecarEngine({ transport })
    const r = await engine.redact('x')
    expect(r.confidence).toBe(0)
    const f = r.findings[0]
    expect(f?.kind).toBe('classifier-error')
    expect(f?.fields).toContain('parse error')
  })

  it('decodes two findings in the same payload', async () => {
    const transport = new FakeSidecarTransport((req): JsonRpcResponse => ({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        value: '[REDACTED] [REDACTED]',
        findings: [
          { kind: 'person', count: 1, fields: ['user.name'] },
          { kind: 'location', count: 1, fields: ['user.addr'] },
        ],
        confidence: 0.7,
      },
    }))
    const engine = new PresidioSidecarEngine({ transport })
    const r = await engine.redact({ user: { name: 'X', addr: 'Y' } })
    expect(r.findings.length).toBe(2)
    const kinds = r.findings.map((f) => f.kind).sort()
    expect(kinds).toEqual(['location', 'person'])
  })

  it('preserves nested object value returned by the sidecar', async () => {
    const transport = new FakeSidecarTransport((req): JsonRpcResponse => ({
      jsonrpc: '2.0',
      id: req.id,
      result: {
        value: { user: { email: '[REDACTED]', note: 'ok' } },
        findings: [{ kind: 'email', count: 1, fields: ['user.email'] }],
        confidence: 0.95,
      },
    }))
    const engine = new PresidioSidecarEngine({ transport })
    const r = await engine.redact({ user: { email: 'x@y.io', note: 'ok' } })
    expect(r.value).toEqual({ user: { email: '[REDACTED]', note: 'ok' } })
    expect(r.findings[0]?.fields).toEqual(['user.email'])
  })
})
