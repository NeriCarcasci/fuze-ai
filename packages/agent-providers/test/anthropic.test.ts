import { describe, expect, it, vi } from 'vitest'
import type { ModelGenerateInput } from '@fuze-ai/agent'
import { anthropic, AnthropicNotInstalledError } from '../src/anthropic.js'
import type { FetchLike } from '../src/openai-compat.js'

const okResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const baseInput: ModelGenerateInput = {
  messages: [
    { role: 'system', content: 'you are helpful' },
    { role: 'user', content: 'ping' },
  ],
  tools: [],
}

describe('anthropic', () => {
  it('POSTs to api.anthropic.com with x-api-key, anthropic-version, and partitioned system message', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      okResponse({
        content: [{ type: 'text', text: 'pong' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 5, output_tokens: 2 },
      }),
    )
    const model = anthropic({ apiKey: 'sk-ant', region: 'us', fetchImpl })
    await model.generate(baseInput)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    const headers = init.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('sk-ant')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    const body = JSON.parse(String(init.body))
    expect(body.system).toBe('you are helpful')
    expect(body.messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'ping' }] },
    ])
    expect(body.max_tokens).toBeGreaterThan(0)
  })

  it('routes to api.eu.anthropic.com when region=eu and reports residency="eu"', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      okResponse({
        content: [{ type: 'text', text: 'ok' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    )
    const model = anthropic({ apiKey: 'k', region: 'eu', fetchImpl })
    expect(model.providerName).toBe('anthropic')
    expect(model.residency).toBe('eu')
    await model.generate(baseInput)
    const [url] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://api.eu.anthropic.com/v1/messages')
  })

  it('reports residency="us" when region=us', () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      okResponse({ content: [], stop_reason: 'end_turn' }),
    )
    const model = anthropic({ apiKey: 'k', region: 'us', fetchImpl })
    expect(model.residency).toBe('us')
  })

  it('parses tool_use blocks into ModelStep.toolCalls', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      okResponse({
        content: [
          { type: 'text', text: 'thinking...' },
          { type: 'tool_use', id: 'tu_1', name: 'echo', input: { text: 'hi' } },
        ],
        stop_reason: 'tool_use',
        usage: { input_tokens: 10, output_tokens: 4 },
      }),
    )
    const model = anthropic({ apiKey: 'k', region: 'eu', fetchImpl })
    const step = await model.generate(baseInput)
    expect(step.content).toBe('thinking...')
    expect(step.toolCalls).toEqual([
      { id: 'tu_1', name: 'echo', args: { text: 'hi' } },
    ])
    expect(step.finishReason).toBe('tool_calls')
    expect(step.tokensIn).toBe(10)
    expect(step.tokensOut).toBe(4)
  })

  it('throws AnthropicNotInstalledError when sdk is absent and no fetchImpl provided', () => {
    expect(() => anthropic({ apiKey: 'k', region: 'us' })).toThrow(
      AnthropicNotInstalledError,
    )
  })

  it('AnthropicNotInstalledError carries install instructions', () => {
    const err = new AnthropicNotInstalledError()
    expect(err.message).toMatch(/@anthropic-ai\/sdk/)
    expect(err.name).toBe('AnthropicNotInstalledError')
  })

  it('throws on non-2xx responses', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      new Response('overloaded', { status: 529 }),
    )
    const model = anthropic({ apiKey: 'k', region: 'us', fetchImpl })
    await expect(model.generate(baseInput)).rejects.toThrow(/HTTP 529/)
  })
})
