import { z } from 'zod'
import {
  defineTool,
  Ok,
  Retry,
  type FuzeSandbox,
  type RetentionPolicy,
} from '@fuze-ai/agent'
import type { PublicTool } from '@fuze-ai/agent'

export interface ListFilesToolDeps {
  readonly sandbox: FuzeSandbox
  readonly retention: RetentionPolicy
}

const listFilesInput = z.object({
  path: z.string().min(1),
})

const listFilesOutput = z.object({
  files: z.array(z.string()),
})

type ListFilesIn = z.infer<typeof listFilesInput>
type ListFilesOut = z.infer<typeof listFilesOutput>

export const listFilesTool = (
  deps: ListFilesToolDeps,
): PublicTool<ListFilesIn, ListFilesOut, unknown> =>
  defineTool.public<ListFilesIn, ListFilesOut>({
    name: 'list_files',
    description: 'List the entries of a directory inside the sandbox filesystem.',
    input: listFilesInput,
    output: listFilesOutput,
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
          { command: `list_files ${input.path}` },
          ctx,
        )
        if (result.exitCode !== 0) {
          return {
            ok: false,
            error: Retry(`list-files-nonzero-exit:${result.exitCode}`, result.stderr),
          }
        }
        const files = result.stdout
          .split('\n')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
        return Ok({ files })
      } catch (err) {
        return { ok: false, error: Retry('sandbox-exec-failed', err) }
      }
    },
  })
