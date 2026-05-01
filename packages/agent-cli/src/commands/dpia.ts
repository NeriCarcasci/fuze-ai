import { readFile } from 'node:fs/promises'
import { generateDpia } from '@fuze-ai/agent-compliance'
import type { AgentDefinition } from '@fuze-ai/agent'
import { formatJson } from '../format.js'
import type { CommandResult } from './health.js'

export interface DpiaCommandInput {
  readonly agentDefinitionPath: string
  readonly readFileImpl?: (path: string) => Promise<string>
}

const defaultRead = async (path: string): Promise<string> => readFile(path, 'utf8')

export const runDpiaCommand = async (input: DpiaCommandInput): Promise<CommandResult> => {
  if (!input.agentDefinitionPath) {
    return { exitCode: 1, stdout: '', stderr: 'dpia: <agent-definition.json> is required\n' }
  }
  const read = input.readFileImpl ?? defaultRead
  let raw: string
  try {
    raw = await read(input.agentDefinitionPath)
  } catch (err) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `dpia: cannot read ${input.agentDefinitionPath}: ${err instanceof Error ? err.message : String(err)}\n`,
    }
  }
  let definition: AgentDefinition<unknown, unknown>
  try {
    definition = JSON.parse(raw) as AgentDefinition<unknown, unknown>
  } catch (err) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `dpia: invalid JSON: ${err instanceof Error ? err.message : String(err)}\n`,
    }
  }
  const document = generateDpia(definition)
  return { exitCode: 0, stdout: formatJson(document) + '\n', stderr: '' }
}
