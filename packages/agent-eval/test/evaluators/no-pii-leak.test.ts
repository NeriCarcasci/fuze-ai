import { describe, it, expect } from 'vitest'
import { noPiiLeakEvaluator } from '../../src/evaluators/no-pii-leak.js'
import { SECRET_REDACTED } from '@fuze-ai/agent'

const ev = noPiiLeakEvaluator<unknown, unknown>()
const baseCase = { id: 'c', input: null }

describe('noPiiLeakEvaluator', () => {
  it('passes when no redaction marker is present', async () => {
    const r = await ev.evaluate({
      case: baseCase,
      actualOutput: { final: 'hello' },
      status: 'completed',
      records: [],
    })
    expect(r.passed).toBe(true)
  })

  it('fails when actualOutput contains the redaction marker', async () => {
    const r = await ev.evaluate({
      case: baseCase,
      actualOutput: { final: `leaked: ${SECRET_REDACTED}` },
      status: 'completed',
      records: [],
    })
    expect(r.passed).toBe(false)
  })
})
