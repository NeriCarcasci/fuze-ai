import { describe, expect, it, vi } from 'vitest'
import { ApiClient, ApiClientError } from '../src/api-client.js'

const stubResponse = (body: unknown, status = 200): Response =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })

describe('ApiClient', () => {
  it('sends bearer authorization header', async () => {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>
      expect(headers.authorization).toBe('Bearer secret-key')
      return stubResponse({ ok: true })
    })
    const client = new ApiClient({
      baseUrl: 'http://localhost:8080',
      apiKey: 'secret-key',
      fetchImpl,
    })
    const out = await client.health()
    expect(out.ok).toBe(true)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('encodes query params for audit query', async () => {
    let capturedUrl = ''
    const fetchImpl = vi.fn(async (url: string) => {
      capturedUrl = url
      return stubResponse({ records: [] })
    })
    const client = new ApiClient({
      baseUrl: 'http://api.test',
      apiKey: 'k',
      fetchImpl,
    })
    await client.auditQuery({ subject: 'abc def', since: '2026-01-01' })
    expect(capturedUrl).toBe('http://api.test/v1/subjects/abc%20def/spans?since=2026-01-01')
  })

  it('throws ApiClientError with status and body on 4xx', async () => {
    const fetchImpl = vi.fn(async () => stubResponse('forbidden', 403))
    const client = new ApiClient({
      baseUrl: 'http://x',
      apiKey: 'k',
      fetchImpl,
      maxRetries: 0,
    })
    await expect(client.health()).rejects.toBeInstanceOf(ApiClientError)
    try {
      await client.health()
    } catch (err) {
      expect(err).toBeInstanceOf(ApiClientError)
      const e = err as ApiClientError
      expect(e.status).toBe(403)
      expect(e.body).toBe('forbidden')
    }
  })

  it('retries on 5xx and recovers', async () => {
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls++
      if (calls < 2) return stubResponse('boom', 503)
      return stubResponse({ ok: true })
    })
    const client = new ApiClient({
      baseUrl: 'http://x',
      apiKey: 'k',
      fetchImpl,
      maxRetries: 3,
      retryDelayMs: 1,
    })
    const out = await client.health()
    expect(out.ok).toBe(true)
    expect(calls).toBe(2)
  })
})
