import { z } from 'zod'
import {
  defineTool,
  Ok,
  Retry,
  type FuzeSandbox,
  type RetentionPolicy,
} from '@fuze-ai/agent'
import type { PublicTool } from '@fuze-ai/agent'

export interface ReadFileToolDeps {
  readonly sandbox: FuzeSandbox
  readonly retention: RetentionPolicy
}

const readFileInput = z.object({
  path: z.string().min(1),
})

const readFileOutput = z.object({
  content: z.string(),
})

type ReadFileIn = z.infer<typeof readFileInput>
type ReadFileOut = z.infer<typeof readFileOutput>

export const readFileTool = (
  deps: ReadFileToolDeps,
): PublicTool<ReadFileIn, ReadFileOut, unknown> =>
  defineTool.public<ReadFileIn, ReadFileOut>({
    name: 'read_file',
    description: 'Read a file from the sandbox filesystem and return its UTF-8 contents.',
    input: readFileInput,
    output: readFileOutput,
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
          { command: `read_file ${input.path}` },
          ctx,
        )
        if (result.exitCode !== 0) {
          return {
            ok: false,
            error: Retry(`read-file-nonzero-exit:${result.exitCode}`, result.stderr),
          }
        }
        return Ok({ content: result.stdout })
      } catch (err) {
        return { ok: false, error: Retry('sandbox-exec-failed', err) }
      }
    },
  })
