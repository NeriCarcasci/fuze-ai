import { describe, expect, it } from 'vitest'
import { iso42001Mapping } from '../src/mappings/iso-42001.js'

describe('ISO 42001 mapping', () => {
  it('every control has at least one attribute', () => {
    for (const section of iso42001Mapping.sections) {
      expect(section.attributes.length).toBeGreaterThan(0)
    }
  })

  it('control IDs are unique and start with A.', () => {
    const ids = iso42001Mapping.sections.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id.startsWith('A.')).toBe(true)
    }
  })

  it('covers logging control with evidence-hash attributes', () => {
    const logging = iso42001Mapping.sections.find((s) => s.id.startsWith('A.9'))
    expect(logging).toBeDefined()
    expect(logging?.attributes).toContain('fuze.evidence.hash')
  })

  it('declares mapping metadata', () => {
    expect(iso42001Mapping.id).toBe('iso-42001')
    expect(iso42001Mapping.version).toBe('2023')
  })
})
