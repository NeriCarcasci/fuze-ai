import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { schemaShapeEvaluator } from '../../src/evaluators/schema-shape.js'

const schema = z.object({ name: z.string(), age: z.number() })
const ev = schemaShapeEvaluator(schema)
const baseCase = { id: 'c', input: null }

describe('schemaShapeEvaluator', () => {
  it('passes when output matches schema', async () => {
    const r = await ev.evaluate({
      case: baseCase,
      actualOutput: { name: 'Bob', age: 30 },
      status: 'completed',
      records: [],
    })
    expect(r.passed).toBe(true)
  })

  it('fails when output mismatches schema', async () => {
    const r = await ev.evaluate({
      case: baseCase,
      actualOutput: { name: 'Bob' },
      status: 'completed',
      records: [],
    })
    expect(r.passed).toBe(false)
    expect(r.evidence).toBeDefined()
  })

  it('fails when actualOutput is undefined', async () => {
    const r = await ev.evaluate({
      case: baseCase,
      actualOutput: undefined,
      status: 'error',
      records: [],
    })
    expect(r.passed).toBe(false)
  })
})
