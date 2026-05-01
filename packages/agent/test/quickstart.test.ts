import { describe, expect, it, vi, beforeEach } from 'vitest'
import { z } from 'zod'
import { quickAgent, quickTool } from '../src/quickstart/index.js'
import type { FuzeModel, ModelStep } from '../src/types/model.js'

const scriptedModel = (steps: readonly ModelStep[]): FuzeModel => {
  let i = 0
  return {
    providerName: 'fake',
    modelName: 'fake-1',
    residency: 'eu',
    generate: async () => {
      const s = steps[i++]
      if (!s) throw new Error('scriptedModel exhausted')
      return s
    },
  }
}

describe('quickstart — warning', () => {
  it('warns once about default allow-all policy on first run, not on subsequent runs', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const make = (): ReturnType<typeof quickAgent> =>
      quickAgent({
        model: scriptedModel([
          {
            content: '{"answer":"ok"}',
            toolCalls: [],
            finishReason: 'stop',
            tokensIn: 1,
            tokensOut: 1,
          },
        ]),
        tools: [],
      })
    await make().run('hi')
    await make().run('hi')
    const allowAllWarnings = warn.mock.calls.filter((call) =>
      String(call[0] ?? '').includes('allow-all policy'),
    )
    expect(allowAllWarnings.length).toBe(1)
    warn.mockRestore()
  })
})

describe('quickstart — quickTool', () => {
  it('roundtrips a raw value through Ok wrapping and produces a public-classified tool', async () => {
    const greet = quickTool({
      name: 'greet',
      description: 'greet by name',
      input: z.object({ name: z.string() }),
      output: z.object({ greeting: z.string() }),
      run: ({ name }) => ({ greeting: `hello, ${name}` }),
    })
    expect(greet.dataClassification).toBe('public')
    expect(greet.retention.id).toBe('fuze.quickstart.v1')
    const result = await greet.run({ name: 'world' }, {} as never)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toEqual({ greeting: 'hello, world' })
  })
})

describe('quickstart — quickAgent', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('runs end-to-end with a scripted model and returns a typed output', async () => {
    const greet = quickTool({
      name: 'greet',
      description: 'greet by name',
      input: z.object({ name: z.string() }),
      output: z.object({ greeting: z.string() }),
      run: ({ name }) => ({ greeting: `hello, ${name}` }),
    })
    const agent = quickAgent({
      model: scriptedModel([
        {
          content: '',
          toolCalls: [{ id: 'c1', name: 'greet', args: { name: 'world' } }],
          finishReason: 'tool_calls',
          tokensIn: 5,
          tokensOut: 3,
        },
        {
          content: '{"answer":"hello, world"}',
          toolCalls: [],
          finishReason: 'stop',
          tokensIn: 6,
          tokensOut: 4,
        },
      ]),
      tools: [greet],
    })
    const result = await agent.run('greet world please')
    expect(result.status).toBe('completed')
    expect(result.output).toEqual({ answer: 'hello, world' })
  })

  it('emits hash-chained evidence records visible via .records()', async () => {
    const agent = quickAgent({
      model: scriptedModel([
        {
          content: '{"answer":"ok"}',
          toolCalls: [],
          finishReason: 'stop',
          tokensIn: 1,
          tokensOut: 1,
        },
      ]),
      tools: [],
    })
    await agent.run('hi')
    const records = agent.records()
    expect(records.length).toBeGreaterThan(0)
    expect(records[0]?.payload.role).toBe('agent')
    for (let i = 1; i < records.length; i++) {
      expect(records[i]?.prevHash).toBe(records[i - 1]?.hash)
    }
  })

})
