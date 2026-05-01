import { describe, expect, it } from 'vitest'
import { generateDpa } from '../src/dpa.js'
import type { DpaInput, DpaSecurityMeasures, DpaSubProcessor } from '../src/types.js'
import { buildAgent, controllerParty, processorParty } from './fixtures.js'

const sm: DpaSecurityMeasures = {
  evidenceSigner: 'Ed25519 + RFC 8785 canonical JSON',
  transparencyLog: 'Trillian append-only log, anchored daily',
  encryptionAtRest: 'AES-256-GCM, KMS-managed keys',
  encryptionInTransit: 'TLS 1.3',
  accessControl: 'Cerbos RBAC + tenant isolation',
}

const subs: readonly DpaSubProcessor[] = [
  {
    name: 'OpenAI Ireland Limited',
    role: 'LLM inference',
    country: 'IE',
    residency: 'eu',
    transferMechanism: 'adequacy',
  },
]

const baseInput = (): DpaInput => ({
  controller: controllerParty,
  processor: processorParty,
  definition: buildAgent(),
  subjectCategories: ['Customers', 'Prospects'],
  durationDescription: 'For the term of the master services agreement.',
  securityMeasures: sm,
  subProcessors: subs,
  governingLaw: 'Laws of the Netherlands.',
})

describe('generateDpa', () => {
  it('produces a markdown document with the Art. 28 section headings', () => {
    const md = generateDpa(baseInput())
    expect(md).toContain('# Data Processing Agreement (GDPR Art. 28)')
    expect(md).toContain('## 1. Parties')
    expect(md).toContain('## 9. Sub-processors')
    expect(md).toContain('## 12. Personal data breach notification')
  })

  it('fills the processing purpose from the AgentDefinition', () => {
    const md = generateDpa(baseInput())
    expect(md).toContain('process customer support requests')
  })

  it('infers data categories from tool dataClassification', () => {
    const md = generateDpa(baseInput())
    expect(md).toContain('Personal data (Art. 4(1) GDPR)')
    expect(md).toContain('Non-personal / public data')
  })

  it('renders the sub-processor table when sub-processors are provided', () => {
    const md = generateDpa(baseInput())
    expect(md).toContain('| Name | Role | Country |')
    expect(md).toContain('OpenAI Ireland Limited')
  })

  it('throws a clear error when a required field is missing', () => {
    const bad: DpaInput = { ...baseInput(), subjectCategories: [] }
    expect(() => generateDpa(bad)).toThrowError(/subjectCategories/)
  })

  it('contains LAWYER REVIEW markers on every judgement-required section', () => {
    const md = generateDpa(baseInput())
    const matches = md.match(/<!-- LAWYER REVIEW:/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(5)
  })

  it('shows a no-sub-processors notice when the manifest is empty', () => {
    const md = generateDpa({ ...baseInput(), subProcessors: [] })
    expect(md).toContain('No sub-processors at the time of generation')
  })
})
