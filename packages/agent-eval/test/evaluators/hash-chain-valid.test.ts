import { describe, it, expect } from 'vitest'
import { hashChainValidEvaluator } from '../../src/evaluators/hash-chain-valid.js'
import { runEvaluation } from '../../src/runner.js'
import { buildEchoAgent } from '../fixtures.js'

describe('hashChainValidEvaluator', () => {
  it('passes for an empty chain', async () => {
    const ev = hashChainValidEvaluator()
    const r = await ev.evaluate({
      case: { id: 'c', input: null },
      actualOutput: undefined,
      status: 'completed',
      records: [],
    })
    expect(r.passed).toBe(true)
  })

  it('passes for a real run', async () => {
    const agent = buildEchoAgent('hi')
    const report = await runEvaluation({
      dataset: { cases: [{ id: 'c1', input: { text: 'hi' } }] },
      agent,
      evaluators: [hashChainValidEvaluator()],
    })
    expect(report.cases[0]?.passed).toBe(true)
  })
})
