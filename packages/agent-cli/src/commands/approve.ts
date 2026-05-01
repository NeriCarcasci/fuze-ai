import { ApiClient, type ApiClientOptions, type ApprovalRequest } from '../api-client.js'
import { renderOutput } from '../format.js'
import type { CommandResult } from './health.js'

export interface ApproveCommandInput {
  readonly client?: ApiClient
  readonly clientOptions?: ApiClientOptions
  readonly runId: string
  readonly action: string
  readonly rationale: string
  readonly overseer: string
  readonly json?: boolean
}

const VALID: ReadonlyArray<ApprovalRequest['action']> = ['approve', 'reject', 'halt', 'override']

const isValidAction = (a: string): a is ApprovalRequest['action'] =>
  (VALID as readonly string[]).includes(a)

export const runApproveCommand = async (input: ApproveCommandInput): Promise<CommandResult> => {
  if (!input.runId) {
    return { exitCode: 1, stdout: '', stderr: 'approve: <runId> is required\n' }
  }
  if (!isValidAction(input.action)) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `approve: --action must be one of ${VALID.join('|')}\n`,
    }
  }
  if (!input.rationale) {
    return { exitCode: 1, stdout: '', stderr: 'approve: --rationale is required\n' }
  }
  if (!input.overseer) {
    return { exitCode: 1, stdout: '', stderr: 'approve: --overseer is required\n' }
  }
  const client =
    input.client ??
    new ApiClient(
      input.clientOptions ?? (() => { throw new Error('client or clientOptions required') })(),
    )
  try {
    const result = await client.approve({
      runId: input.runId,
      action: input.action,
      rationale: input.rationale,
      overseer: input.overseer,
    })
    return {
      exitCode: result.accepted ? 0 : 2,
      stdout: renderOutput(result, { json: input.json === true }) + '\n',
      stderr: '',
    }
  } catch (err) {
    return {
      exitCode: 2,
      stdout: '',
      stderr: `approve failed: ${err instanceof Error ? err.message : String(err)}\n`,
    }
  }
}
