import { describe, expect, it } from 'vitest'
import { generateTia } from '../src/tia.js'
import type { DpaSubProcessor, TiaInput, TiaSupplementaryMeasures } from '../src/types.js'
import { RET, controllerParty, processorParty } from './fixtures.js'

const importer: DpaSubProcessor = {
  name: 'CRM Vendor Inc.',
  role: 'CRM hosting',
  country: 'US',
  residency: 'any',
  transferMechanism: 'scc',
}

const supp: TiaSupplementaryMeasures = {
  encryption: 'AES-256-GCM at rest, TLS 1.3 in transit; importer holds no decryption keys.',
  pseudonymisation: 'Customer identifiers replaced with HMAC-SHA-256 subject refs prior to export.',
  contractual: 'EU 2021/914 SCCs Module 2 with EDPB Annex II TOMs; warrants on government access.',
  organisational: 'Quarterly access-log review; immediate suspension on government-access request.',
}

const baseInput = (): TiaInput => ({
  subProcessor: importer,
  controller: controllerParty,
  processor: processorParty,
  dataFlows: [
    {
      category: 'Account contact details',
      classification: 'personal',
      purpose: 'CRM contact management',
    },
  ],
  lawfulBasis: 'contract',
  retention: RET,
  supplementaryMeasures: supp,
  transferPurpose: 'Hosted CRM for customer-success workflows.',
})

describe('generateTia', () => {
  it('generates valid TIA markdown with required headings', () => {
    const md = generateTia(baseInput())
    expect(md).toContain('# Transfer Impact Assessment')
    expect(md).toContain('## 1. Description of the transfer')
    expect(md).toContain('## 2. Third-country law analysis')
    expect(md).toContain('## 4. Overall conclusion')
  })

  it('lists data flows in a table', () => {
    const md = generateTia(baseInput())
    expect(md).toContain('| Category | Classification | Purpose |')
    expect(md).toContain('Account contact details')
    expect(md).toContain('personal')
  })

  it('includes a supplementary-measures section with all four sub-headings', () => {
    const md = generateTia(baseInput())
    expect(md).toContain('### 3.1 Encryption')
    expect(md).toContain('### 3.2 Pseudonymisation')
    expect(md).toContain('### 3.3 Contractual measures')
    expect(md).toContain('### 3.4 Organisational measures')
  })

  it('embeds LAWYER REVIEW markers on judgement sections', () => {
    const md = generateTia(baseInput())
    const matches = md.match(/<!-- LAWYER REVIEW:/g) ?? []
    expect(matches.length).toBeGreaterThanOrEqual(3)
  })

  it('throws when transferPurpose is missing', () => {
    expect(() => generateTia({ ...baseInput(), transferPurpose: '' })).toThrowError(
      /transferPurpose/,
    )
  })
})
