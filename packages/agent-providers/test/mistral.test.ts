import { describe, expect, it, vi } from 'vitest'
import type { ModelGenerateInput } from '@fuze-ai/agent'
import { mistralModel } from '../src/mistral.js'
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

describe('mistralModel', () => {
  it('POSTs to the Mistral chat-completions URL with bearer auth and JSON body', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      okResponse({
        choices: [{ finish_reason: 'stop', message: { content: 'pong' } }],
        usage: { prompt_tokens: 2, completion_tokens: 1 },
      }),
    )
    const model = mistralModel({ apiKey: 'sk-test', fetchImpl })
    await model.generate(baseInput)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://api.mistral.ai/v1/chat/completions')
    expect(init.method).toBe('POST')
    const headers = init.headers as Record<string, string>
    expect(headers['authorization']).toBe('Bearer sk-test')
    expect(headers['content-type']).toBe('application/json')
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('mistral-large-latest')
    expect(body.messages).toEqual([{ role: 'user', content: 'ping' }])
  })

  it('returns a ModelStep with token counts and EU residency', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      okResponse({
        choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
        usage: { prompt_tokens: 11, completion_tokens: 4 },
      }),
    )
    const model = mistralModel({ apiKey: 'k', model: 'mistral-small-latest', fetchImpl })
    expect(model.providerName).toBe('mistral')
    expect(model.residency).toBe('eu')
    expect(model.modelName).toBe('mistral-small-latest')
    const step = await model.generate(baseInput)
    expect(step.tokensIn).toBe(11)
    expect(step.tokensOut).toBe(4)
    expect(step.content).toBe('ok')
    expect(step.finishReason).toBe('stop')
  })

  it('throws on non-2xx responses', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      new Response('forbidden', { status: 403 }),
    )
    const model = mistralModel({ apiKey: 'k', fetchImpl })
    await expect(model.generate(baseInput)).rejects.toThrow(/HTTP 403/)
  })
})
