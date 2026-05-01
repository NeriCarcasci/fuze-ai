import { readFile } from 'node:fs/promises'
import {
  commissionAnnexIvMapping,
  generateAnnexIvReport,
  iso42001Mapping,
  type AnnexIvMapping,
  type EvidenceRecord,
} from '@fuze-ai/agent-annex-iv'
import type { AgentDefinition } from '@fuze-ai/agent'
import { formatJson } from '../format.js'
import type { CommandResult } from './health.js'

export interface AnnexIvCommandInput {
  readonly agentDefinitionPath: string
  readonly recordsPath: string
  readonly mapping?: 'commission' | 'iso-42001'
  readonly readFileImpl?: (path: string) => Promise<string>
}

const defaultRead = async (path: string): Promise<string> => readFile(path, 'utf8')

const parseJsonl = (raw: string): EvidenceRecord[] => {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0)
  return lines.map((l) => JSON.parse(l) as EvidenceRecord)
}

const pickMapping = (name: 'commission' | 'iso-42001' | undefined): AnnexIvMapping =>
  name === 'iso-42001' ? iso42001Mapping : commissionAnnexIvMapping

export const runAnnexIvCommand = async (input: AnnexIvCommandInput): Promise<CommandResult> => {
  if (!input.agentDefinitionPath) {
    return { exitCode: 1, stdout: '', stderr: 'annex-iv: <agent-definition.json> is required\n' }
  }
  if (!input.recordsPath) {
    return { exitCode: 1, stdout: '', stderr: 'annex-iv: --records <file.jsonl> is required\n' }
  }
  const read = input.readFileImpl ?? defaultRead
  let agentRaw: string
  let recordsRaw: string
  try {
    agentRaw = await read(input.agentDefinitionPath)
    recordsRaw = await read(input.recordsPath)
  } catch (err) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `annex-iv: read failed: ${err instanceof Error ? err.message : String(err)}\n`,
    }
  }
  let definition: AgentDefinition<unknown, unknown>
  let records: EvidenceRecord[]
  try {
    definition = JSON.parse(agentRaw) as AgentDefinition<unknown, unknown>
    records = parseJsonl(recordsRaw)
  } catch (err) {
    return {
      exitCode: 1,
      stdout: '',
      stderr: `annex-iv: parse failed: ${err instanceof Error ? err.message : String(err)}\n`,
    }
  }
  const report = generateAnnexIvReport({
    records,
    agentDefinition: definition,
    mapping: pickMapping(input.mapping),
  })
  return { exitCode: 0, stdout: formatJson(report) + '\n', stderr: '' }
}
