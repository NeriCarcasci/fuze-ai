import { describe, expect, it } from 'vitest'
import { commissionAnnexIvMapping } from '../src/mappings/commission.js'

describe('commission Annex IV mapping', () => {
  it('every section has at least one attribute', () => {
    for (const section of commissionAnnexIvMapping.sections) {
      expect(section.attributes.length).toBeGreaterThan(0)
    }
  })

  it('attribute names are non-empty strings', () => {
    for (const section of commissionAnnexIvMapping.sections) {
      for (const attr of section.attributes) {
        expect(typeof attr).toBe('string')
        expect(attr.length).toBeGreaterThan(0)
      }
    }
  })

  it('section IDs are unique', () => {
    const ids = commissionAnnexIvMapping.sections.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('covers all seven Annex IV top-level sections', () => {
    const idText = commissionAnnexIvMapping.sections.map((s) => s.id).join(' ')
    for (const num of [1, 2, 3, 4, 5, 6, 7]) {
      expect(idText).toContain(`§${num}`)
    }
  })

  it('logging section names the evidence hash and tenant attributes', () => {
    const logging = commissionAnnexIvMapping.sections.find((s) => s.id === '§4(a) automatic logging')
    expect(logging).toBeDefined()
    expect(logging?.attributes).toContain('fuze.evidence.hash')
    expect(logging?.attributes).toContain('fuze.tenant.id')
  })

  it('technical specs section names gen_ai model attributes', () => {
    const tech = commissionAnnexIvMapping.sections.find((s) => s.id === '§3(a) technical specifications')
    expect(tech?.attributes).toContain('gen_ai.request.model')
  })
})
