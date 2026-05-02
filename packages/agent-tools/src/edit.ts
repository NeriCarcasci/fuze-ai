import { z } from 'zod'
import {
  defineTool,
  Ok,
  Retry,
  type FuzeSandbox,
  type RetentionPolicy,
} from '@fuze-ai/agent'
import type { PublicTool } from '@fuze-ai/agent'

export interface EditToolDeps {
  readonly sandbox: FuzeSandbox
  readonly retention: RetentionPolicy
}

const editInput = z.object({
  path: z.string().min(1),
  oldString: z.string(),
  newString: z.string(),
  expectedOccurrences: z.number().int().positive().optional(),
})

const editOutput = z.object({
  path: z.string(),
  occurrencesReplaced: z.number().int().nonnegative(),
  bytesWritten: z.number().int().nonnegative(),
})

type EditIn = z.infer<typeof editInput>
type EditOut = z.infer<typeof editOutput>

interface SandboxEditEnvelope {
  readonly occurrencesReplaced?: number
  readonly bytesWritten?: number
}

export const editTool = (deps: EditToolDeps): PublicTool<EditIn, EditOut, unknown> =>
  defineTool.public<EditIn, EditOut>({
    name: 'edit',
    description:
      'Atomically replace occurrences of oldString with newString in a file inside the sandbox. Refuses no-op edits and refuses when occurrence count differs from expectedOccurrences.',
    input: editInput,
    output: editOutput,
    threatBoundary: {
      trustedCallers: ['agent-loop'],
      observesSecrets: false,
      egressDomains: 'none',
      readsFilesystem: true,
      writesFilesystem: true,
    },
    retention: deps.retention,
    run: async (input, ctx) => {
      if (input.oldString === input.newString) {
        return { ok: false, error: Retry('edit-no-op') }
      }
      try {
        const result = await deps.sandbox.exec(
          { command: 'edit', stdin: JSON.stringify(input) },
          ctx,
        )
        if (result.exitCode !== 0) {
          const stderr = result.stderr.trim()
          if (stderr.startsWith('edit-')) {
            return { ok: false, error: Retry(stderr, result.stderr) }
          }
          return {
            ok: false,
            error: Retry(`edit-nonzero-exit:${result.exitCode}`, result.stderr),
          }
        }
        let envelope: SandboxEditEnvelope
        try {
          envelope = JSON.parse(result.stdout) as SandboxEditEnvelope
        } catch (err) {
          return { ok: false, error: Retry('edit-bad-envelope', err) }
        }
        const occurrencesReplaced =
          typeof envelope.occurrencesReplaced === 'number' &&
          Number.isInteger(envelope.occurrencesReplaced) &&
          envelope.occurrencesReplaced >= 0
            ? envelope.occurrencesReplaced
            : 0
        const bytesWritten =
          typeof envelope.bytesWritten === 'number' &&
          Number.isInteger(envelope.bytesWritten) &&
          envelope.bytesWritten >= 0
            ? envelope.bytesWritten
            : 0
        return Ok({ path: input.path, occurrencesReplaced, bytesWritten })
      } catch (err) {
        return { ok: false, error: Retry('sandbox-exec-failed', err) }
      }
    },
  })
