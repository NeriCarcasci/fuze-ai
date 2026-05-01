import { describe, expect, it } from 'vitest'
import { Hono } from 'hono'
import { rateLimit } from '../src/rate-limit.js'

const buildApp = (
  opts: { windowMs: number; max: number; key?: (c: { req: { header(name: string): string | undefined } }) => string; now?: () => number },
): Hono => {
  const app = new Hono()
  app.use(
    '/test',
    rateLimit({
      windowMs: opts.windowMs,
      max: opts.max,
      ...(opts.key ? { key: opts.key as never } : {}),
      ...(opts.now ? { now: opts.now } : {}),
    }),
  )
  app.get('/test', (c) => c.json({ ok: true }))
  return app
}

describe('rateLimit middleware', () => {
  it('lets calls under the limit through', async () => {
    const app = buildApp({ windowMs: 60_000, max: 3 })
    const headers = { authorization: 'Bearer key-1' }
    for (let i = 0; i < 3; i++) {
      const res = await app.fetch(
        new Request('http://x/test', { headers: headers as unknown as Headers }),
      )
      expect(res.status).toBe(200)
    }
  })

  it('returns 429 once the limit is exceeded', async () => {
    const app = buildApp({ windowMs: 60_000, max: 2 })
    const headers = { authorization: 'Bearer key-1' }
    await app.fetch(new Request('http://x/test', { headers: headers as unknown as Headers }))
    await app.fetch(new Request('http://x/test', { headers: headers as unknown as Headers }))
    const blocked = await app.fetch(
      new Request('http://x/test', { headers: headers as unknown as Headers }),
    )
    expect(blocked.status).toBe(429)
  })

  it('sets a Retry-After header on 429', async () => {
    const app = buildApp({ windowMs: 60_000, max: 1 })
    const headers = { authorization: 'Bearer key-1' }
    await app.fetch(new Request('http://x/test', { headers: headers as unknown as Headers }))
    const blocked = await app.fetch(
      new Request('http://x/test', { headers: headers as unknown as Headers }),
    )
    expect(blocked.status).toBe(429)
    const retry = blocked.headers.get('retry-after')
    expect(retry).toBeDefined()
    expect(Number(retry)).toBeGreaterThan(0)
  })

  it('keeps separate counters per distinct key', async () => {
    const app = buildApp({ windowMs: 60_000, max: 1 })
    const a = await app.fetch(
      new Request('http://x/test', {
        headers: { authorization: 'Bearer key-A' } as unknown as Headers,
      }),
    )
    const b = await app.fetch(
      new Request('http://x/test', {
        headers: { authorization: 'Bearer key-B' } as unknown as Headers,
      }),
    )
    expect(a.status).toBe(200)
    expect(b.status).toBe(200)
    const blockedA = await app.fetch(
      new Request('http://x/test', {
        headers: { authorization: 'Bearer key-A' } as unknown as Headers,
      }),
    )
    expect(blockedA.status).toBe(429)
  })

  it('window resets after windowMs elapses', async () => {
    let nowMs = 1_000_000
    const app = buildApp({ windowMs: 1000, max: 1, now: () => nowMs })
    const headers = { authorization: 'Bearer key-W' }
    const first = await app.fetch(
      new Request('http://x/test', { headers: headers as unknown as Headers }),
    )
    expect(first.status).toBe(200)
    const blocked = await app.fetch(
      new Request('http://x/test', { headers: headers as unknown as Headers }),
    )
    expect(blocked.status).toBe(429)
    nowMs += 2000
    const after = await app.fetch(
      new Request('http://x/test', { headers: headers as unknown as Headers }),
    )
    expect(after.status).toBe(200)
  })

  it('uses the custom key function when provided', async () => {
    const app = buildApp({
      windowMs: 60_000,
      max: 1,
      key: (c) => c.req.header('x-tenant') ?? 'shared',
    })
    const t1 = await app.fetch(
      new Request('http://x/test', {
        headers: { 'x-tenant': 't-1' } as unknown as Headers,
      }),
    )
    const t2 = await app.fetch(
      new Request('http://x/test', {
        headers: { 'x-tenant': 't-2' } as unknown as Headers,
      }),
    )
    expect(t1.status).toBe(200)
    expect(t2.status).toBe(200)
    const t1Blocked = await app.fetch(
      new Request('http://x/test', {
        headers: { 'x-tenant': 't-1' } as unknown as Headers,
      }),
    )
    expect(t1Blocked.status).toBe(429)
  })
})
