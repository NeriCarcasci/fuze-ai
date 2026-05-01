import { z } from 'zod'
import {
  defineTool,
  Ok,
  Retry,
  type FuzeSandbox,
  type RetentionPolicy,
} from '@fuze-ai/agent'
import type { PublicTool } from '@fuze-ai/agent'

export interface WriteFileToolDeps {
  readonly sandbox: FuzeSandbox
  readonly retention: RetentionPolicy
}

const writeFileInput = z.object({
  path: z.string().min(1),
  content: z.string(),
})

const writeFileOutput = z.object({
  bytesWritten: z.number().int().nonnegative(),
})

type WriteFileIn = z.infer<typeof writeFileInput>
type WriteFileOut = z.infer<typeof writeFileOutput>

export const writeFileTool = (
  deps: WriteFileToolDeps,
): PublicTool<WriteFileIn, WriteFileOut, unknown> =>
  defineTool.public<WriteFileIn, WriteFileOut>({
    name: 'write_file',
    description: 'Write a UTF-8 string to a file inside the sandbox filesystem.',
    input: writeFileInput,
    output: writeFileOutput,
    threatBoundary: {
      trustedCallers: ['agent-loop'],
      observesSecrets: false,
      egressDomains: 'none',
      readsFilesystem: false,
      writesFilesystem: true,
    },
    retention: deps.retention,
    run: async (input, ctx) => {
      try {
        const result = await deps.sandbox.exec(
          { command: `write_file ${input.path}`, stdin: input.content },
          ctx,
        )
        if (result.exitCode !== 0) {
          return {
            ok: false,
            error: Retry(`write-file-nonzero-exit:${result.exitCode}`, result.stderr),
          }
        }
        const parsed = Number.parseInt(result.stdout.trim(), 10)
        const bytesWritten = Number.isFinite(parsed) && parsed >= 0 ? parsed : Buffer.byteLength(input.content, 'utf8')
        return Ok({ bytesWritten })
      } catch (err) {
        return { ok: false, error: Retry('sandbox-exec-failed', err) }
      }
    },
  })
