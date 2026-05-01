import { ApiClient, type ApiClientOptions } from '../api-client.js'
import { renderOutput } from '../format.js'
import type { CommandResult } from './health.js'

export interface AuditQueryCommandInput {
  readonly client?: ApiClient
  readonly clientOptions?: ApiClientOptions
  readonly subject: string
  readonly tenant: string
  readonly since?: string
  readonly json?: boolean
}

export const runAuditQueryCommand = async (
  input: AuditQueryCommandInput,
): Promise<CommandResult> => {
  if (!input.subject) {
    return { exitCode: 1, stdout: '', stderr: 'audit query: --subject is required\n' }
  }
  const client =
    input.client ??
    new ApiClient(
      input.clientOptions ?? (() => { throw new Error('client or clientOptions required') })(),
    )
  try {
    const params = {
      subject: input.subject,
      ...(input.since !== undefined ? { since: input.since } : {}),
    }
    const result = await client.auditQuery(params)
    const output = input.json
      ? renderOutput(result, { json: true })
      : renderOutput(result.spans, { json: false })
    return { exitCode: 0, stdout: output + '\n', stderr: '' }
  } catch (err) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `audit query failed: ${err instanceof Error ? err.message : String(err)}\n`,
    }
  }
}
