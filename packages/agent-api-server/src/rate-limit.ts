import { createHash } from 'node:crypto'
import type { Context, MiddlewareHandler } from 'hono'

export interface RateLimitOptions {
  readonly windowMs: number
  readonly max: number
  readonly key?: (c: Context) => string
  readonly now?: () => number
  readonly sweepIntervalMs?: number
}

interface Bucket {
  count: number
  resetAt: number
}

const hashAuth = (auth: string): string =>
  createHash('sha256').update(auth).digest('hex').slice(0, 32)

const defaultKey = (c: Context): string => {
  const rawAuth = c.req.header('authorization') ?? 'anon'
  const auth = rawAuth === 'anon' ? 'anon' : hashAuth(rawAuth)
  const route = new URL(c.req.url).pathname
  return `${auth}::${route}`
}

export const rateLimit = (opts: RateLimitOptions): MiddlewareHandler => {
  const buckets = new Map<string, Bucket>()
  const now = opts.now ?? (() => Date.now())
  const keyFn = opts.key ?? defaultKey
  const sweepInterval = opts.sweepIntervalMs ?? Math.max(opts.windowMs, 60_000)
  let lastSweep = now()

  const sweepIfDue = (t: number): void => {
    if (t - lastSweep < sweepInterval) return
    for (const [k, b] of buckets) {
      if (b.resetAt <= t) buckets.delete(k)
    }
    lastSweep = t
  }

  return async (c, next) => {
    const k = keyFn(c)
    const t = now()
    sweepIfDue(t)
    let bucket = buckets.get(k)
    if (!bucket || bucket.resetAt <= t) {
      bucket = { count: 0, resetAt: t + opts.windowMs }
      buckets.set(k, bucket)
    }

    if (bucket.count >= opts.max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - t) / 1000))
      return new Response(JSON.stringify({ error: 'rate limit exceeded' }), {
        status: 429,
        headers: {
          'content-type': 'application/json',
          'retry-after': String(retryAfterSeconds),
        },
      })
    }

    bucket.count++
    await next()
    return
  }
}
