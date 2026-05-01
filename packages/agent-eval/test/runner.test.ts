import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { runEvaluation } from '../src/runner.js'
import { exactMatchEvaluator } from '../src/evaluators/exact-match.js'
import { schemaShapeEvaluator } from '../src/evaluators/schema-shape.js'
import { hashChainValidEvaluator } from '../src/evaluators/hash-chain-valid.js'
import { buildEchoAgent } from './fixtures.js'

describe('runEvaluation', () => {
  it('runs all cases and reports pass rate', async () => {
    const report = await runEvaluation({
      dataset: {
        cases: [
          { id: 'c1', input: { text: 'hello' }, expectedOutput: { echo: 'hello' } },
        ],
      },
      agent: buildEchoAgent('hello'),
      evaluators: [exactMatchEvaluator()],
    })
    expect(report.totalCases).toBe(1)
    expect(report.passedCases).toBe(1)
    expect(report.passRate).toBe(1)
  })

  it('marks a case failed when an evaluator fails', async () => {
    const agent = buildEchoAgent('hello')
    const report = await runEvaluation({
      dataset: {
        cases: [{ id: 'c1', input: { text: 'hello' }, expectedOutput: { echo: 'NOT MATCHING' } }],
      },
      agent,
      evaluators: [exactMatchEvaluator()],
    })
    expect(report.passRate).toBe(0)
    expect(report.cases[0]?.passed).toBe(false)
  })

  it('aggregates score across multiple evaluators', async () => {
    const agent = buildEchoAgent('hi')
    const report = await runEvaluation({
      dataset: {
        cases: [{ id: 'c1', input: { text: 'hi' }, expectedOutput: { echo: 'hi' } }],
      },
      agent,
      evaluators: [
        exactMatchEvaluator(),
        schemaShapeEvaluator(z.object({ echo: z.string() })),
        hashChainValidEvaluator(),
      ],
    })
    expect(report.cases[0]?.aggregateScore).toBe(1)
    expect(report.cases[0]?.results.length).toBe(3)
  })

  it('reports zero cases as 100% (no failures)', async () => {
    const agent = buildEchoAgent('x')
    const report = await runEvaluation({
      dataset: { cases: [] },
      agent,
      evaluators: [exactMatchEvaluator()],
    })
    expect(report.passRate).toBe(1)
    expect(report.totalCases).toBe(0)
  })

  it('emits evidence records per case', async () => {
    const agent = buildEchoAgent('hello')
    const report = await runEvaluation({
      dataset: { cases: [{ id: 'c1', input: { text: 'hello' } }] },
      agent,
      evaluators: [hashChainValidEvaluator()],
    })
    expect(report.cases[0]?.recordCount ?? 0).toBeGreaterThan(0)
  })
})
