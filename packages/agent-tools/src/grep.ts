import { z } from 'zod'
import {
  defineTool,
  Ok,
  Retry,
  type FuzeSandbox,
  type RetentionPolicy,
} from '@fuze-ai/agent'
import type { PublicTool } from '@fuze-ai/agent'

export interface GrepToolDeps {
  readonly sandbox: FuzeSandbox
  readonly retention: RetentionPolicy
}

const grepInput = z.object({
  pattern: z.string().min(1),
  path: z.string().min(1),
  glob: z.string().optional(),
  caseInsensitive: z.boolean().optional(),
  maxMatches: z.number().int().positive().max(10_000).optional(),
})

const grepMatch = z.object({
  path: z.string(),
  line: z.number().int().positive(),
  text: z.string(),
})

const grepOutput = z.object({
  matches: z.array(grepMatch),
  truncated: z.boolean(),
  durationMs: z.number().int().nonnegative(),
})

type GrepIn = z.infer<typeof grepInput>
type GrepOut = z.infer<typeof grepOutput>

interface SandboxGrepEnvelope {
  readonly matches?: ReadonlyArray<{ path?: string; line?: number; text?: string }>
  readonly truncated?: boolean
}

export const grepTool = (deps: GrepToolDeps): PublicTool<GrepIn, GrepOut, unknown> =>
  defineTool.public<GrepIn, GrepOut>({
    name: 'grep',
    description:
      'Search files inside the sandbox for a regex pattern. Returns matching lines with their paths and line numbers.',
    input: grepInput,
    output: grepOutput,
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
          { command: 'grep', stdin: JSON.stringify(input) },
          ctx,
        )
        if (result.exitCode !== 0) {
          return {
            ok: false,
            error: Retry(`grep-nonzero-exit:${result.exitCode}`, result.stderr),
          }
        }
        let envelope: SandboxGrepEnvelope
        try {
          envelope = JSON.parse(result.stdout) as SandboxGrepEnvelope
        } catch (err) {
          return { ok: false, error: Retry('grep-bad-envelope', err) }
        }
        const rawMatches = envelope.matches ?? []
        const matches: GrepOut['matches'] = []
        for (const m of rawMatches) {
          if (
            typeof m.path === 'string' &&
            typeof m.line === 'number' &&
            Number.isInteger(m.line) &&
            m.line > 0 &&
            typeof m.text === 'string'
          ) {
            matches.push({ path: m.path, line: m.line, text: m.text })
          }
        }
        return Ok({
          matches,
          truncated: envelope.truncated === true,
          durationMs: result.durationMs,
        })
      } catch (err) {
        return { ok: false, error: Retry('sandbox-exec-failed', err) }
      }
    },
  })
