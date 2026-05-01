import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { setZodWarnSink, zodToJsonSchema } from '../src/zod-to-json-schema.js'

describe('zodToJsonSchema', () => {
  it('converts a simple z.object with required string/number/boolean', () => {
    const schema = z.object({
      title: z.string(),
      count: z.number(),
      active: z.boolean(),
    })
    const out = zodToJsonSchema(schema)
    expect(out).toEqual({
      type: 'object',
      properties: {
        title: { type: 'string' },
        count: { type: 'number' },
        active: { type: 'boolean' },
      },
      required: ['title', 'count', 'active'],
    })
  })

  it('marks z.optional() fields as not required', () => {
    const schema = z.object({
      a: z.string(),
      b: z.string().optional(),
    })
    const out = zodToJsonSchema(schema)
    expect(out.required).toEqual(['a'])
    expect(out.properties?.['b']).toEqual({ type: 'string' })
  })

  it('converts z.array of strings', () => {
    const schema = z.object({ tags: z.array(z.string()) })
    const out = zodToJsonSchema(schema)
    expect(out.properties?.['tags']).toEqual({ type: 'array', items: { type: 'string' } })
  })

  it('converts nested z.object', () => {
    const schema = z.object({
      user: z.object({ id: z.string(), age: z.number() }),
    })
    const out = zodToJsonSchema(schema)
    expect(out.properties?.['user']).toEqual({
      type: 'object',
      properties: {
        id: { type: 'string' },
        age: { type: 'number' },
      },
      required: ['id', 'age'],
    })
  })

  it('emits {} and warns for unsupported zod types (e.g. union)', () => {
    const sink = vi.fn()
    setZodWarnSink(sink)
    const schema = z.object({ x: z.union([z.string(), z.number()]) })
    const out = zodToJsonSchema(schema)
    expect(out.properties?.['x']).toEqual({})
    expect(sink).toHaveBeenCalled()
    setZodWarnSink(() => undefined)
  })

  it('handles arrays of objects', () => {
    const schema = z.object({
      items: z.array(z.object({ name: z.string() })),
    })
    const out = zodToJsonSchema(schema)
    expect(out.properties?.['items']).toEqual({
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
      },
    })
  })
})
