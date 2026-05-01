import { createHash } from 'node:crypto'
import type { AgentDefinition } from '../types/agent.js'
import type { AnyFuzeTool } from '../types/tool.js'
import { canonicalize } from '../evidence/canonical.js'

const fingerprintTool = (tool: AnyFuzeTool): Record<string, unknown> => ({
  name: tool.name,
  dataClassification: tool.dataClassification,
  description: tool.description,
})

export const computeDefinitionFingerprint = <TDeps, TOut>(
  def: AgentDefinition<TDeps, TOut>,
): string => {
  const canonical = canonicalize({
    purpose: def.purpose,
    lawfulBasis: def.lawfulBasis,
    annexIIIDomain: def.annexIIIDomain,
    producesArt22Decision: def.producesArt22Decision,
    model: { providerName: def.model.providerName, modelName: def.model.modelName },
    tools: def.tools.map(fingerprintTool).sort((a, b) => (a.name as string).localeCompare(b.name as string)),
    maxSteps: def.maxSteps,
    retention: def.retention.id,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

export class DefinitionFingerprintMismatchError extends Error {
  constructor(
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`definition fingerprint mismatch: expected ${expected}, got ${actual}`)
    this.name = 'DefinitionFingerprintMismatchError'
  }
}
