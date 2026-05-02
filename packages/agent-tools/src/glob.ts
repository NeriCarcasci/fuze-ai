import { z } from 'zod'
import {
  defineTool,
  Ok,
  Retry,
  type FuzeSandbox,
  type RetentionPolicy,
} from '@fuze-ai/agent'
import type { PublicTool } from '@fuze-ai/agent'

export interface GlobToolDeps {
  readonly sandbox: FuzeSandbox
  readonly retention: RetentionPolicy
}

const globInput = z.object({
  pattern: z.string().min(1),
  path: z.string().min(1).optional(),
  maxResults: z.number().int().positive().max(100_000).optional(),
})

const globOutput = z.object({
  paths: z.array(z.string()),
  truncated: z.boolean(),
  durationMs: z.number().int().nonnegative(),
})

type GlobIn = z.infer<typeof globInput>
type GlobOut = z.infer<typeof globOutput>

interface SandboxGlobEnvelope {
  readonly paths?: ReadonlyArray<unknown>
  readonly truncated?: boolean
}

export const globTool = (deps: GlobToolDeps): PublicTool<GlobIn, GlobOut, unknown> =>
  defineTool.public<GlobIn, GlobOut>({
    name: 'glob',
    description:
      'Expand a glob pattern against the sandbox filesystem and return matching paths.',
    input: globInput,
    output: globOutput,
    threatBoundary: {
      trustedCallers: ['agent-loop'],
      observesSecrets: false,
      egressDomains: 'none',
      readsFilesystem: true,
      writesFilesystem: false,
    },
    retention: deps.retention,
    run: async (input, ctx) => {
      try {
        const result = await deps.sandbox.exec(
          { command: 'glob', stdin: JSON.stringify(input) },
          ctx,
        )
        if (result.exitCode !== 0) {
          return {
            ok: false,
            error: Retry(`glob-nonzero-exit:${result.exitCode}`, result.stderr),
          }
        }
        let envelope: SandboxGlobEnvelope
        try {
          envelope = JSON.parse(result.stdout) as SandboxGlobEnvelope
        } catch (err) {
          return { ok: false, error: Retry('glob-bad-envelope', err) }
        }
        const rawPaths = envelope.paths ?? []
        const paths: string[] = []
        for (const p of rawPaths) {
          if (typeof p === 'string') paths.push(p)
        }
        return Ok({
          paths,
          truncated: envelope.truncated === true,
          durationMs: result.durationMs,
        })
      } catch (err) {
        return { ok: false, error: Retry('sandbox-exec-failed', err) }
      }
    },
  })
