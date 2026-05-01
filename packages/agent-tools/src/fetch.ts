import { z } from 'zod'
import {
  defineTool,
  Ok,
  Retry,
  type FuzeSandbox,
  type RetentionPolicy,
} from '@fuze-ai/agent'
import type { PublicTool } from '@fuze-ai/agent'

export interface FetchToolDeps {
  readonly sandbox: FuzeSandbox
  readonly retention: RetentionPolicy
  readonly allowedDomains: readonly string[]
}

const fetchInput = z.object({
  url: z.string().url(),
})

const fetchOutput = z.object({
  status: z.number().int(),
  body: z.string(),
  headers: z.record(z.string()),
})

type FetchIn = z.infer<typeof fetchInput>
type FetchOut = z.infer<typeof fetchOutput>

const hostMatches = (host: string, allowed: readonly string[]): boolean => {
  const h = host.toLowerCase()
  return allowed.some((domain) => {
    const d = domain.toLowerCase()
    return h === d || h.endsWith(`.${d}`)
  })
}

interface SandboxFetchEnvelope {
  readonly status?: number
  readonly body?: string
  readonly headers?: Record<string, string>
}

export const fetchTool = (deps: FetchToolDeps): PublicTool<FetchIn, FetchOut, unknown> =>
  defineTool.public<FetchIn, FetchOut>({
    name: 'fetch',
    description: 'HTTP GET a URL through the sandbox. Refuses URLs whose host is not in the allowlist.',
    input: fetchInput,
    output: fetchOutput,
    threatBoundary: {
      trustedCallers: ['agent-loop'],
      observesSecrets: false,
      egressDomains: deps.allowedDomains,
      readsFilesystem: false,
      writesFilesystem: false,
    },
    retention: deps.retention,
    run: async (input, ctx) => {
      let parsed: URL
      try {
        parsed = new URL(input.url)
      } catch (err) {
        return { ok: false, error: Retry('fetch-url-invalid', err) }
      }
      if (!hostMatches(parsed.hostname, deps.allowedDomains)) {
        return {
          ok: false,
          error: Retry(`fetch-host-not-allowed:${parsed.hostname}`),
        }
      }

      try {
        const result = await deps.sandbox.exec(
          {
            command: `fetch ${input.url}`,
          },
          ctx,
        )
        if (result.exitCode !== 0) {
          return { ok: false, error: Retry(`fetch-nonzero-exit:${result.exitCode}`, result.stderr) }
        }
        let envelope: SandboxFetchEnvelope
        try {
          envelope = JSON.parse(result.stdout) as SandboxFetchEnvelope
        } catch (err) {
          return { ok: false, error: Retry('fetch-bad-envelope', err) }
        }
        const status = envelope.status ?? 0
        const body = envelope.body ?? ''
        const headers = envelope.headers ?? {}
        return Ok({ status, body, headers })
      } catch (err) {
        return { ok: false, error: Retry('sandbox-exec-failed', err) }
      }
    },
  })
