import { z } from 'zod'
import {
  defineTool,
  Ok,
  Retry,
  type FuzeSandbox,
  type RetentionPolicy,
} from '@fuze-ai/agent'
import type { PublicTool } from '@fuze-ai/agent'
import type {
  WebSearchHit,
  WebSearchProvider,
  WebSearchResponseEnvelope,
} from './web-search/types.js'

export interface WebSearchToolDeps {
  readonly sandbox: FuzeSandbox
  readonly retention: RetentionPolicy
  readonly provider: WebSearchProvider
}

const webSearchInput = z.object({
  query: z.string().min(1),
  maxResults: z.number().int().positive().max(50).optional(),
  country: z.string().optional(),
  safeSearch: z.enum(['strict', 'moderate', 'off']).optional(),
})

const webSearchHit = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
})

const webSearchOutput = z.object({
  hits: z.array(webSearchHit),
  durationMs: z.number().int().nonnegative(),
})

type WebSearchIn = z.infer<typeof webSearchInput>
type WebSearchOut = z.infer<typeof webSearchOutput>

export const webSearchTool = (
  deps: WebSearchToolDeps,
): PublicTool<WebSearchIn, WebSearchOut, unknown> =>
  defineTool.public<WebSearchIn, WebSearchOut>({
    name: 'web_search',
    description: `Web search via the ${deps.provider.name} provider, routed through the sandbox. Returns title/url/snippet hits.`,
    input: webSearchInput,
    output: webSearchOutput,
    threatBoundary: {
      trustedCallers: ['agent-loop'],
      observesSecrets: false,
      egressDomains: [...deps.provider.egressDomains],
      readsFilesystem: false,
      writesFilesystem: false,
    },
    retention: deps.retention,
    run: async (input, ctx) => {
      const started = Date.now()
      const opts: { maxResults?: number; country?: string; safeSearch?: 'strict' | 'moderate' | 'off' } = {}
      if (input.maxResults !== undefined) opts.maxResults = input.maxResults
      if (input.country !== undefined) opts.country = input.country
      if (input.safeSearch !== undefined) opts.safeSearch = input.safeSearch

      let req: ReturnType<WebSearchProvider['buildRequest']>
      try {
        req = deps.provider.buildRequest(input.query, opts)
      } catch (err) {
        return { ok: false, error: Retry('web-search-build-request-failed', err) }
      }

      const stdinPayload: {
        url: string
        method: string
        headers?: Record<string, string>
        body?: string
      } = {
        url: req.url,
        method: req.method ?? 'GET',
      }
      if (req.headers) stdinPayload.headers = req.headers
      if (req.body !== undefined) stdinPayload.body = req.body

      let result
      try {
        result = await deps.sandbox.exec(
          { command: 'fetch', stdin: JSON.stringify(stdinPayload) },
          ctx,
        )
      } catch (err) {
        return { ok: false, error: Retry('sandbox-exec-failed', err) }
      }
      if (result.exitCode !== 0) {
        return {
          ok: false,
          error: Retry(`web-search-nonzero-exit:${result.exitCode}`, result.stderr),
        }
      }

      let envelope: WebSearchResponseEnvelope
      try {
        const parsed = JSON.parse(result.stdout) as {
          status?: unknown
          body?: unknown
          headers?: unknown
        }
        envelope = {
          status: typeof parsed.status === 'number' ? parsed.status : 0,
          body: typeof parsed.body === 'string' ? parsed.body : '',
          headers:
            parsed.headers && typeof parsed.headers === 'object'
              ? (parsed.headers as Record<string, string>)
              : {},
        }
      } catch (err) {
        return { ok: false, error: Retry('web-search-bad-envelope', err) }
      }
      if (envelope.status < 200 || envelope.status >= 300) {
        return {
          ok: false,
          error: Retry(`web-search-status:${envelope.status}`, envelope.body),
        }
      }

      let hits: readonly WebSearchHit[]
      try {
        hits = deps.provider.parseResponse(envelope)
      } catch (err) {
        return { ok: false, error: Retry('web-search-parse-failed', err) }
      }
      return Ok({ hits: [...hits], durationMs: Date.now() - started })
    },
  })

export type { WebSearchHit, WebSearchProvider, WebSearchOptions } from './web-search/types.js'
