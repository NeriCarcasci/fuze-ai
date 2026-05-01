import { describe, it, expect } from 'vitest'
import { exactMatchEvaluator } from '../../src/evaluators/exact-match.js'

const ev = exactMatchEvaluator<unknown, unknown>()
const baseCase = { id: 'c', input: null }

describe('exactMatchEvaluator', () => {
  it('passes when actual deep-equals expected', async () => {
    const r = await ev.evaluate({
      case: { ...baseCase, expectedOutput: { a: 1, b: [1, 2] } },
      actualOutput: { a: 1, b: [1, 2] },
      status: 'completed',
      records: [],
    })
    expect(r.passed).toBe(true)
    expect(r.score).toBe(1)
  })

  it('fails when shapes differ', async () => {
    const r = await ev.evaluate({
      case: { ...baseCase, expectedOutput: { a: 1 } },
      actualOutput: { a: 2 },
      status: 'completed',
      records: [],
    })
    expect(r.passed).toBe(false)
  })

  it('fails when expected is missing on the case', async () => {
    const r = await ev.evaluate({
      case: baseCase,
      actualOutput: { a: 1 },
      status: 'completed',
      records: [],
    })
    expect(r.passed).toBe(false)
  })
})
