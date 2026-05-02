import { describe, expect, it, vi } from 'vitest'
import type { ModelGenerateInput } from '@fuze-ai/agent'
import { openAI, OpenAINotInstalledError } from '../src/openai.js'
import type { FetchLike } from '../src/openai-compat.js'

const okResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const baseInput: ModelGenerateInput = {
  messages: [{ role: 'user', content: 'ping' }],
  tools: [],
}

describe('openAI', () => {
  it('POSTs to api.openai.com with bearer auth and JSON body', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      okResponse({
        choices: [{ finish_reason: 'stop', message: { content: 'pong' } }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      }),
    )
    const model = openAI({ apiKey: 'sk-test', fetchImpl })
    await model.generate(baseInput)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['authorization']).toBe('Bearer sk-test')
    expect(headers['content-type']).toBe('application/json')
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('gpt-4o-mini')
  })

  it('reports providerName="openai" and residency="us"', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      okResponse({
        choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
        usage: { prompt_tokens: 4, completion_tokens: 2 },
      }),
    )
    const model = openAI({ apiKey: 'k', model: 'gpt-4o', fetchImpl })
    expect(model.providerName).toBe('openai')
    expect(model.residency).toBe('us')
    expect(model.modelName).toBe('gpt-4o')
    const step = await model.generate(baseInput)
    expect(step.tokensIn).toBe(4)
    expect(step.tokensOut).toBe(2)
    expect(step.finishReason).toBe('stop')
  })

  it('honors a custom baseURL', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      okResponse({
        choices: [{ finish_reason: 'stop', message: { content: 'x' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    )
    const model = openAI({
      apiKey: 'k',
      baseURL: 'https://gateway.example.com/v1',
      fetchImpl,
    })
    await model.generate(baseInput)
    const [url] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://gateway.example.com/v1/chat/completions')
  })

  it('throws OpenAINotInstalledError when openai sdk is absent and no fetchImpl provided', () => {
    expect(() => openAI({ apiKey: 'k' })).toThrow(OpenAINotInstalledError)
  })

  it('OpenAINotInstalledError carries install instructions', () => {
    const err = new OpenAINotInstalledError()
    expect(err.message).toMatch(/npm install openai/)
    expect(err.name).toBe('OpenAINotInstalledError')
  })

  it('throws on non-2xx responses', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      new Response('rate limited', { status: 429 }),
    )
    const model = openAI({ apiKey: 'k', fetchImpl })
    await expect(model.generate(baseInput)).rejects.toThrow(/HTTP 429/)
  })
})
