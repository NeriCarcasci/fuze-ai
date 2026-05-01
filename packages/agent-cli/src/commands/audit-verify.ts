import { ApiClient, type ApiClientOptions } from '../api-client.js'
import { renderOutput } from '../format.js'
import type { CommandResult } from './health.js'

export interface AuditVerifyCommandInput {
  readonly client?: ApiClient
  readonly clientOptions?: ApiClientOptions
  readonly runId: string
  readonly json?: boolean
}

export const runAuditVerifyCommand = async (
  input: AuditVerifyCommandInput,
): Promise<CommandResult> => {
  if (!input.runId) {
    return { exitCode: 1, stdout: '', stderr: 'audit verify: <runId> is required\n' }
  }
  const client =
    input.client ??
    new ApiClient(
      input.clientOptions ?? (() => { throw new Error('client or clientOptions required') })(),
    )
  try {
    const result = await client.runVerify(input.runId)
    const out = renderOutput(result, { json: input.json === true })
    const exitCode = result.chainValid ? 0 : 2
    return { exitCode, stdout: out + '\n', stderr: '' }
  } catch (err) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `audit verify failed: ${err instanceof Error ? err.message : String(err)}\n`,
    }
  }
}
