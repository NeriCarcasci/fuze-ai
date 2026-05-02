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

export interface BashStreamToolDeps {
  readonly sandbox: FuzeSandbox
  readonly retention: RetentionPolicy
}

const bashStreamInput = z.object({
  command: z.string().min(1),
  stdin: z.string().optional(),
})

const bashStreamOutput = z.object({
  stdout: z.string(),
  stderr: z.string(),
  exitCode: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  tier: z.enum(['in-process', 'vm-managed', 'vm-self-hosted']),
  chunkCount: z.number().int().nonnegative(),
})

type BashStreamIn = z.infer<typeof bashStreamInput>
type BashStreamOut = z.infer<typeof bashStreamOutput>

interface StreamEnvelope {
  readonly chunks: readonly string[]
  readonly stderr: string
  readonly exitCode: number
}

const parseEnvelope = (raw: string): StreamEnvelope | null => {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (parsed === null || typeof parsed !== 'object') return null
    const e = parsed as { chunks?: unknown; stderr?: unknown; exitCode?: unknown }
    if (!Array.isArray(e.chunks)) return null
    if (!e.chunks.every((c) => typeof c === 'string')) return null
    if (typeof e.stderr !== 'string') return null
    if (typeof e.exitCode !== 'number' || !Number.isInteger(e.exitCode)) return null
    return { chunks: e.chunks as string[], stderr: e.stderr, exitCode: e.exitCode }
  } catch {
    return null
  }
}

export const bashStreamTool = (deps: BashStreamToolDeps): PublicTool<BashStreamIn, BashStreamOut, unknown> =>
  defineTool.public<BashStreamIn, BashStreamOut>({
    name: 'bash_stream',
    description:
      'Run a shell command inside the sandbox, emitting incremental tool.partial spans for each stdout chunk.',
    input: bashStreamInput,
    output: bashStreamOutput,
    threatBoundary: {
      trustedCallers: ['agent-loop'],
      observesSecrets: false,
      egressDomains: 'none',
      readsFilesystem: true,
      writesFilesystem: true,
    },
    retention: deps.retention,
    run: async (input, ctx) => {
      const payload: { command: string; stdin?: string } = { command: input.command }
      if (input.stdin !== undefined) payload.stdin = input.stdin
      const execInput = { command: 'bash_stream', stdin: JSON.stringify(payload) }
      let result
      try {
        result = await deps.sandbox.exec(execInput, ctx)
      } catch (err) {
        return { ok: false, error: Retry('sandbox-exec-failed', err) }
      }
      const envelope = parseEnvelope(result.stdout)
      if (!envelope) {
        return { ok: false, error: Retry('bash_stream-bad-envelope', new Error(result.stdout.slice(0, 200))) }
      }
      const total = envelope.chunks.length
      let stdout = ''
      const emitChild = ctx.emitChild
      for (let i = 0; i < total; i++) {
        const chunk = envelope.chunks[i] ?? ''
        stdout += chunk
        const finalChunk = i === total - 1
        if (emitChild) {
          emitChild({
            span: 'tool.partial',
            attrs: {
              'gen_ai.tool.name': 'bash_stream',
              'fuze.partial.sequence_number': i,
              'fuze.partial.final_chunk': finalChunk,
              'fuze.partial.byte_length': Buffer.byteLength(chunk, 'utf8'),
            },
            content: { chunk },
          })
        }
      }
      return Ok({
        stdout,
        stderr: envelope.stderr,
        exitCode: envelope.exitCode,
        durationMs: result.durationMs,
        tier: result.tier satisfies SandboxTier,
        chunkCount: total,
      })
    },
  })
