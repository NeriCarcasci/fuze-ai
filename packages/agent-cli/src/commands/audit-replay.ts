import { ApiClient, type ApiClientOptions } from '../api-client.js'
import { formatJson } from '../format.js'
import type { CommandResult } from './health.js'

export interface AuditReplayCommandInput {
  readonly client?: ApiClient
  readonly clientOptions?: ApiClientOptions
  readonly runId: string
  readonly json?: boolean
  readonly interactive?: boolean
  readonly waitForKey?: () => Promise<void>
  readonly write?: (chunk: string) => void
}

const defaultWaitForKey = async (): Promise<void> => {
  await new Promise<void>((resolve) => {
    const onData = (): void => {
      process.stdin.off('data', onData)
      process.stdin.pause()
      resolve()
    }
    process.stdin.resume()
    process.stdin.once('data', onData)
  })
}

export const runAuditReplayCommand = async (
  input: AuditReplayCommandInput,
): Promise<CommandResult> => {
  if (!input.runId) {
    return { exitCode: 1, stdout: '', stderr: 'audit replay: <runId> is required\n' }
  }
  const client =
    input.client ??
    new ApiClient(
      input.clientOptions ?? (() => { throw new Error('client or clientOptions required') })(),
    )
  const write = input.write ?? ((s: string) => process.stdout.write(s))
  const wait = input.waitForKey ?? defaultWaitForKey
  let captured = ''
  const collect = (s: string): void => {
    captured += s
    write(s)
  }

  try {
    const result = await client.runReplay(input.runId)
    if (input.json) {
      collect(formatJson(result) + '\n')
      return { exitCode: 0, stdout: captured, stderr: '' }
    }
    collect(`run ${input.runId}: ${result.spans.length} spans\n`)
    for (let i = 0; i < result.spans.length; i++) {
      const step = result.spans[i]
      collect(`\n--- span ${i + 1}/${result.spans.length} ---\n`)
      collect(formatJson(step) + '\n')
      if (input.interactive && i < result.spans.length - 1) {
        collect('press any key to continue...\n')
        await wait()
      }
    }
    return { exitCode: 0, stdout: captured, stderr: '' }
  } catch (err) {
    return {
      exitCode: 2,
      stdout: captured,
      stderr: `audit replay failed: ${err instanceof Error ? err.message : String(err)}\n`,
    }
  }
}
