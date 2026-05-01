import { describe, expect, it } from 'vitest'
import { buildOpenApi } from '../src/openapi.js'
import { PATH_TEMPLATES } from '../src/paths.js'

interface Doc {
  openapi: string
  info: { title: string; version: string }
  paths: Record<string, Record<string, unknown>>
  components: { schemas: Record<string, unknown> }
}

describe('OpenAPI doc', () => {
  it('declares OpenAPI 3.1 with paths and components.schemas', () => {
    const doc = buildOpenApi() as unknown as Doc
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.paths).toBeDefined()
    expect(doc.components.schemas).toBeDefined()
    expect(Object.keys(doc.paths).length).toBeGreaterThan(0)
    expect(Object.keys(doc.components.schemas).length).toBeGreaterThan(0)
  })

  it('includes every PATH_TEMPLATE', () => {
    const doc = buildOpenApi() as unknown as Doc
    for (const template of Object.values(PATH_TEMPLATES)) {
      expect(doc.paths[template]).toBeDefined()
    }
  })

  it('every operation references known component schemas only', () => {
    const doc = buildOpenApi() as unknown as Doc
    const known = new Set(Object.keys(doc.components.schemas))
    const refs: string[] = []
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return
      if (Array.isArray(node)) {
        for (const v of node) walk(v)
        return
      }
      const obj = node as Record<string, unknown>
      const ref = obj['$ref']
      if (typeof ref === 'string') refs.push(ref)
      for (const v of Object.values(obj)) walk(v)
    }
    walk(doc.paths)
    expect(refs.length).toBeGreaterThan(0)
    for (const ref of refs) {
      const name = ref.replace('#/components/schemas/', '')
      expect(known.has(name)).toBe(true)
    }
  })

  it('respects custom info title and version', () => {
    const doc = buildOpenApi({ title: 'Test API', version: '9.9.9' }) as unknown as Doc
    expect(doc.info.title).toBe('Test API')
    expect(doc.info.version).toBe('9.9.9')
  })
})
