import { z } from 'zod'
import {
  defineTool,
  Ok,
  Retry,
  type FuzeSandbox,
  type RetentionPolicy,
  type SandboxTier,
} from '@fuze-ai/agent'
import type { PublicTool } from '@fuze-ai/agent'

export interface BashToolDeps {
  readonly sandbox: FuzeSandbox
  readonly retention: RetentionPolicy
}

const bashInput = z.object({
  command: z.string().min(1),
  stdin: z.string().optional(),
})

const bashOutput = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  tier: z.enum(['in-process', 'vm-managed', 'vm-self-hosted']),
})

type BashIn = z.infer<typeof bashInput>
type BashOut = z.infer<typeof bashOutput>

export const bashTool = (deps: BashToolDeps): PublicTool<BashIn, BashOut, unknown> =>
  defineTool.public<BashIn, BashOut>({
    name: 'bash',
    description: 'Run a shell command inside the sandbox and return stdout, stderr, and exit code.',
    input: bashInput,
    output: bashOutput,
    threatBoundary: {
      trustedCallers: ['agent-loop'],
      observesSecrets: false,
      egressDomains: 'none',
      readsFilesystem: true,
      writesFilesystem: true,
    },
    retention: deps.retention,
    run: async (input, ctx) => {
      try {
        const execInput =
          input.stdin === undefined
            ? { command: input.command }
            : { command: input.command, stdin: input.stdin }
        const result = await deps.sandbox.exec(execInput, ctx)
        return Ok({
          stdout: result.stdout,
          stderr: result.stderr,
          exitCode: result.exitCode,
          durationMs: result.durationMs,
          tier: result.tier satisfies SandboxTier,
        })
      } catch (err) {
        return { ok: false, error: Retry('sandbox-exec-failed', err) }
      }
    },
  })
