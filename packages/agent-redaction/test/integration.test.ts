import { describe, expect, it } from 'vitest'
import type { GuardrailResult } from '@fuze-ai/agent'
import { enrichGuardrailEvidence } from '../src/integration.js'
import type { RedactionResult } from '../src/types.js'

describe('enrichGuardrailEvidence', () => {
  it('adds engine, confidence, and kinds keys without dropping existing evidence', () => {
    const base: GuardrailResult = { tripwire: false, evidence: { 'pii.matches': [] } }
    const redaction: RedactionResult = {
      value: 'x',
      findings: [{ kind: 'email', count: 1, fields: ['user.email'] }],
      confidence: 0.9,
    }
    const out = enrichGuardrailEvidence(base, redaction, 'fuze.redaction.regex')
    expect(out.evidence['pii.matches']).toEqual([])
    expect(out.evidence['fuze.redaction.engine']).toBe('fuze.redaction.regex')
    expect(out.evidence['fuze.redaction.confidence']).toBe(0.9)
    expect(out.evidence['fuze.redaction.kinds']).toEqual(['email'])
  })

  it('preserves the original tripwire flag', () => {
    const base: GuardrailResult = { tripwire: true, evidence: {} }
    const redaction: RedactionResult = { value: 'y', findings: [], confidence: 1 }
    const out = enrichGuardrailEvidence(base, redaction, 'fuze.redaction.layered.union')
    expect(out.tripwire).toBe(true)
  })

  it('emits an empty kinds array when there are no findings', () => {
    const base: GuardrailResult = { tripwire: false, evidence: {} }
    const redaction: RedactionResult = { value: 'z', findings: [], confidence: 1 }
    const out = enrichGuardrailEvidence(base, redaction, 'fuze.redaction.regex')
    expect(out.evidence['fuze.redaction.kinds']).toEqual([])
    expect(out.evidence['fuze.redaction.confidence']).toBe(1)
  })
})
