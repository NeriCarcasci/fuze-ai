import { Hono } from 'hono'
import {
  PATHS,
  PostSpansRequestSchema,
  PostSuspendedRunRequestSchema,
  ListSuspendedRunsQuerySchema,
  PostDecisionRequestSchema,
  GetDecisionQuerySchema,
  SubjectSpansQuerySchema,
  toChainedRecord,
  toSuspendedRun,
  toOversightDecision,
} from '@fuze-ai/agent-api'
import { verifyChain } from '@fuze-ai/agent'
import type { OversightDecision, SuspendStore } from '@fuze-ai/agent'
import type { DurableRunStore } from '@fuze-ai/agent-durable'
import type { TenantId, RunId } from '@fuze-ai/agent'
import { makeTenantId, makeRunId } from '@fuze-ai/agent'
import type { Auth, AuthContext } from './auth.js'
import type { SpansStore } from './spans-store.js'
import { LongPollHub } from './long-poll.js'
import { rateLimit, type RateLimitOptions } from './rate-limit.js'
import { InMemoryRunOwnership, type RunOwnershipStore } from './run-ownership.js'

export interface VerifyTransparency {
  verifyAnchor(runId: string): Promise<{ anchored: boolean; logId?: string }>
}

export interface ServerRateLimits {
  readonly spans?: RateLimitOptions | false
  readonly decisions?: RateLimitOptions | false
}

export interface CreateServerOptions {
  readonly suspendStore: SuspendStore
  readonly spansStore: SpansStore
  readonly durableStore?: DurableRunStore
  readonly transparency?: VerifyTransparency
  readonly auth: Auth
  readonly maxLongPollMs?: number
  readonly rateLimits?: ServerRateLimits
  readonly runOwnership?: RunOwnershipStore
}

const DEFAULT_SPANS_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, max: 1000 }
const DEFAULT_DECISIONS_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, max: 60 }

interface DecisionEnvelope {
  readonly decision: OversightDecision
  readonly recordedAt: string
}

const DEFAULT_LONG_POLL_MS = 25_000

export const createFuzeAgentApiServer = (opts: CreateServerOptions): Hono => {
  const app = new Hono()
  const decisionHub = new LongPollHub<DecisionEnvelope>()
  const decisions = new Map<string, { decision: DecisionEnvelope; tenantId: string }>()
  const maxLongPollMs = opts.maxLongPollMs ?? DEFAULT_LONG_POLL_MS
  const ownership = opts.runOwnership ?? new InMemoryRunOwnership()

  const checkOwnership = async (
    runId: string,
    tenantId: string,
  ): Promise<Response | null> => {
    const owner = await ownership.get(runId)
    if (owner === undefined) return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    })
    if (owner !== tenantId) return new Response(JSON.stringify({ error: 'forbidden' }), {
      status: 403,
      headers: { 'content-type': 'application/json' },
    })
    return null
  }

  const authenticate = async (req: Request): Promise<AuthContext | Response> => {
    const result = await opts.auth.authenticate(req.headers)
    if (!result.ok) {
      return new Response(JSON.stringify({ error: result.message }), {
        status: result.status,
        headers: { 'content-type': 'application/json' },
      })
    }
    return result.context
  }

  app.get(PATHS.health, () => {
    return new Response(JSON.stringify({ status: 'ok' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })

  const spansLimit = opts.rateLimits?.spans
  if (spansLimit !== false) {
    app.use(PATHS.spans, rateLimit(spansLimit ?? DEFAULT_SPANS_RATE_LIMIT))
  }
  const decisionsLimit = opts.rateLimits?.decisions
  if (decisionsLimit !== false) {
    app.use(
      '/v1/suspended-runs/:runId/decisions',
      rateLimit(decisionsLimit ?? DEFAULT_DECISIONS_RATE_LIMIT),
    )
  }

  app.post(PATHS.spans, async (c) => {
    const ctx = await authenticate(c.req.raw)
    if (ctx instanceof Response) return ctx

    const body = await c.req.json().catch(() => null)
    const parsed = PostSpansRequestSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400)
    }

    const records = parsed.data.spans.map(toChainedRecord)
    await opts.spansStore.append({ tenantId: ctx.tenantId, records })
    const seenRunIds = new Set<string>()
    for (const r of records) seenRunIds.add(r.payload.runId)
    for (const runId of seenRunIds) await ownership.record(runId, ctx.tenantId)
    return c.json({ accepted: records.length }, 201)
  })

  app.post(PATHS.suspendedRuns, async (c) => {
    const ctx = await authenticate(c.req.raw)
    if (ctx instanceof Response) return ctx

    const body = await c.req.json().catch(() => null)
    const parsed = PostSuspendedRunRequestSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400)
    }

    const suspended = toSuspendedRun(parsed.data.suspendedRun)
    await ownership.record(suspended.runId, ctx.tenantId)
    await opts.suspendStore.save(suspended)
    return c.json({ runId: suspended.runId }, 201)
  })

  app.get(PATHS.suspendedRuns, async (c) => {
    const ctx = await authenticate(c.req.raw)
    if (ctx instanceof Response) return ctx

    const query = ListSuspendedRunsQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams))
    if (!query.success) {
      return c.json({ error: 'invalid query', issues: query.error.issues }, 400)
    }

    const items: unknown[] = []
    if (opts.durableStore) {
      const orphans = await opts.durableStore.listOrphaned(new Date(0))
      const limit = query.data.limit ?? orphans.length
      for (const runId of orphans.slice(0, limit)) {
        const suspended = await opts.suspendStore.load(makeRunId(runId))
        if (suspended) items.push(suspended)
      }
    }
    return c.json({ items, total: items.length }, 200)
  })

  app.get('/v1/suspended-runs/:runId', async (c) => {
    const ctx = await authenticate(c.req.raw)
    if (ctx instanceof Response) return ctx

    const runId = (c.req.param('runId') ?? '')
    const ownershipFail = await checkOwnership(runId, ctx.tenantId)
    if (ownershipFail) return ownershipFail

    const suspended = await opts.suspendStore.load(makeRunId(runId))
    if (!suspended) return c.json({ error: 'not found' }, 404)

    const spans = await opts.spansStore.byRun({ tenantId: ctx.tenantId, runId })
    return c.json({ suspended, spans }, 200)
  })

  app.post('/v1/suspended-runs/:runId/decisions', async (c) => {
    const ctx = await authenticate(c.req.raw)
    if (ctx instanceof Response) return ctx

    const runId = (c.req.param('runId') ?? '')
    const ownershipFail = await checkOwnership(runId, ctx.tenantId)
    if (ownershipFail) return ownershipFail

    const body = await c.req.json().catch(() => null)
    const parsed = PostDecisionRequestSchema.safeParse(body)
    if (!parsed.success) {
      return c.json({ error: 'invalid request', issues: parsed.error.issues }, 400)
    }

    const suspended = await opts.suspendStore.load(makeRunId(runId))
    if (!suspended) return c.json({ error: 'not found' }, 404)

    const decision = toOversightDecision(parsed.data.decision)
    const envelope: DecisionEnvelope = {
      decision,
      recordedAt: new Date().toISOString(),
    }
    decisions.set(runId, { decision: envelope, tenantId: ctx.tenantId })
    await opts.suspendStore.markResumed(makeRunId(runId), decision)
    decisionHub.notify(runId, envelope)
    return c.json({ runId, recordedAt: envelope.recordedAt }, 201)
  })

  app.get('/v1/runs/:runId/decisions', async (c) => {
    const ctx = await authenticate(c.req.raw)
    if (ctx instanceof Response) return ctx

    const runId = (c.req.param('runId') ?? '')
    const ownershipFail = await checkOwnership(runId, ctx.tenantId)
    if (ownershipFail) return ownershipFail

    const query = GetDecisionQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams))
    if (!query.success) {
      return c.json({ error: 'invalid query', issues: query.error.issues }, 400)
    }

    const cached = decisions.get(runId)
    if (cached && cached.tenantId === ctx.tenantId) return c.json(cached.decision, 200)

    const waitMs = Math.min((query.data.wait ?? 0) * 1000, maxLongPollMs)
    if (waitMs > 0) {
      const result = await decisionHub.wait(runId, waitMs)
      if (result) return c.json(result, 200)
    }
    return c.json({ error: 'no decision yet' }, 404)
  })

  app.get('/v1/subjects/:hmac/spans', async (c) => {
    const ctx = await authenticate(c.req.raw)
    if (ctx instanceof Response) return ctx

    const hmac = c.req.param('hmac') ?? ''
    const query = SubjectSpansQuerySchema.safeParse(Object.fromEntries(new URL(c.req.url).searchParams))
    if (!query.success) {
      return c.json({ error: 'invalid query', issues: query.error.issues }, 400)
    }

    const spans = await opts.spansStore.bySubject({
      tenantId: ctx.tenantId,
      subjectHmac: hmac,
      ...(query.data.since ? { since: query.data.since } : {}),
      ...(query.data.limit ? { limit: query.data.limit } : {}),
    })
    return c.json({ spans }, 200)
  })

  app.get('/v1/runs/:runId/verify', async (c) => {
    const ctx = await authenticate(c.req.raw)
    if (ctx instanceof Response) return ctx

    const runId = (c.req.param('runId') ?? '')
    const ownershipFail = await checkOwnership(runId, ctx.tenantId)
    if (ownershipFail) return ownershipFail

    const spans = await opts.spansStore.byRun({ tenantId: ctx.tenantId, runId })
    if (spans.length === 0) return c.json({ error: 'no spans for run' }, 404)

    const chainValid = verifyChain(spans)
    let anchorVerified = false
    let logId: string | undefined
    if (opts.transparency) {
      const result = await opts.transparency.verifyAnchor(runId)
      anchorVerified = result.anchored
      if (result.logId) logId = result.logId
    }

    return c.json({
      runId,
      chainValid,
      anchorVerified,
      ...(logId ? { logId } : {}),
      spanCount: spans.length,
    }, 200)
  })

  app.get('/v1/runs/:runId/spans', async (c) => {
    const ctx = await authenticate(c.req.raw)
    if (ctx instanceof Response) return ctx

    const runId = (c.req.param('runId') ?? '')
    const ownershipFail = await checkOwnership(runId, ctx.tenantId)
    if (ownershipFail) return ownershipFail

    const spans = await opts.spansStore.byRun({ tenantId: ctx.tenantId, runId })
    return c.json({ spans }, 200)
  })

  return app
}

export type { TenantId, RunId }
export { makeTenantId, makeRunId }
