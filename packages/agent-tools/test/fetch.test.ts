import { describe, it, expect } from 'vitest'
import { fetchTool } from '../src/fetch.js'
import { FakeSandbox, makeTestCtx, TEST_RETENTION } from './fake-sandbox.js'

describe('fetchTool', () => {
  it('roundtrip: returns status, body, and headers for an allowed URL', async () => {
    const sandbox = new FakeSandbox({
      httpResponses: {
        'https://api.example.com/v1/ping': {
          status: 200,
          body: 'pong',
          headers: { 'content-type': 'text/plain' },
        },
      },
    })
    const tool = fetchTool({
      sandbox,
      retention: TEST_RETENTION,
      allowedDomains: ['example.com'],
    })
    const result = await tool.run({ url: 'https://api.example.com/v1/ping' }, makeTestCtx())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.status).toBe(200)
    expect(result.value.body).toBe('pong')
    expect(result.value.headers['content-type']).toBe('text/plain')
  })

  it('refuses URLs whose host is not in the allowlist', async () => {
    const sandbox = new FakeSandbox()
    const tool = fetchTool({
      sandbox,
      retention: TEST_RETENTION,
      allowedDomains: ['example.com'],
    })
    const result = await tool.run({ url: 'https://evil.test/leak' }, makeTestCtx())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as { reason: string }).reason).toContain('fetch-host-not-allowed')
    expect(sandbox.calls.length).toBe(0)
  })

  it('treats http:// and https:// equivalently for allowlist matching', async () => {
    const sandbox = new FakeSandbox({
      httpResponses: {
        'http://example.com/': { status: 200, body: 'ok' },
        'https://example.com/': { status: 200, body: 'ok' },
      },
    })
    const tool = fetchTool({
      sandbox,
      retention: TEST_RETENTION,
      allowedDomains: ['example.com'],
    })
    const httpRes = await tool.run({ url: 'http://example.com/' }, makeTestCtx())
    const httpsRes = await tool.run({ url: 'https://example.com/' }, makeTestCtx())
    expect(httpRes.ok).toBe(true)
    expect(httpsRes.ok).toBe(true)
  })

  it('matches host suffixes (api.example.com matches allow example.com)', async () => {
    const sandbox = new FakeSandbox({
      httpResponses: {
        'https://api.example.com/x': { status: 204, body: '' },
      },
    })
    const tool = fetchTool({
      sandbox,
      retention: TEST_RETENTION,
      allowedDomains: ['example.com'],
    })
    const result = await tool.run({ url: 'https://api.example.com/x' }, makeTestCtx())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.status).toBe(204)
  })

  it('declares allowed domains in threatBoundary and public dataClassification', () => {
    const sandbox = new FakeSandbox()
    const tool = fetchTool({
      sandbox,
      retention: TEST_RETENTION,
      allowedDomains: ['example.com', 'api.test'],
    })
    expect(tool.dataClassification).toBe('public')
    expect(tool.threatBoundary.egressDomains).toEqual(['example.com', 'api.test'])
    expect(tool.threatBoundary.readsFilesystem).toBe(false)
    expect(tool.threatBoundary.writesFilesystem).toBe(false)
    expect(tool.input).toBeDefined()
    expect(tool.output).toBeDefined()
  })

  it('does not match when the host only shares a non-domain suffix', async () => {
    const sandbox = new FakeSandbox()
    const tool = fetchTool({
      sandbox,
      retention: TEST_RETENTION,
      allowedDomains: ['example.com'],
    })
    const result = await tool.run({ url: 'https://notexample.com/' }, makeTestCtx())
    expect(result.ok).toBe(false)
  })
})
