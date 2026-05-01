import type { GuardrailResult } from '@fuze-ai/agent'
import type { RedactionResult } from './types.js'

export const enrichGuardrailEvidence = (
  result: GuardrailResult,
  redaction: RedactionResult,
  engineName: string,
): GuardrailResult => {
  const kinds = redaction.findings.map((f) => f.kind)
  const evidence: Record<string, unknown> = { ...result.evidence }
  evidence['fuze.redaction.engine'] = engineName
  evidence['fuze.redaction.confidence'] = redaction.confidence
  evidence['fuze.redaction.kinds'] = kinds
  return {
    tripwire: result.tripwire,
    evidence,
  }
}
