import { ApiClient, type ApiClientOptions } from '../api-client.js'
import { renderOutput } from '../format.js'

export interface HealthCommandInput {
  readonly client?: ApiClient
  readonly clientOptions?: ApiClientOptions
  readonly json?: boolean
}

export interface CommandResult {
  readonly exitCode: 0 | 1 | 2
  readonly stdout: string
  readonly stderr: string
}

const buildClient = (input: HealthCommandInput): ApiClient => {
  if (input.client) return input.client
  if (!input.clientOptions) throw new Error('client or clientOptions required')
  return new ApiClient(input.clientOptions)
}

export const runHealthCommand = async (input: HealthCommandInput): Promise<CommandResult> => {
  const client = buildClient(input)
  try {
    const result = await client.health()
    return {
      exitCode: result.ok ? 0 : 2,
      stdout: renderOutput(result, { json: input.json === true }) + '\n',
      stderr: '',
    }
  } catch (err) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `health check failed: ${err instanceof Error ? err.message : String(err)}\n`,
    }
  }
}
