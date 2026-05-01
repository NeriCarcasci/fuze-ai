import { describe, expect, it, vi } from 'vitest'
import type { ModelGenerateInput } from '@fuze-ai/agent'
import { ovhModel } from '../src/ovh.js'
import type { FetchLike } from '../src/openai-compat.js'

const okResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const baseInput: ModelGenerateInput = {
  messages: [{ role: 'user', content: 'salut' }],
  tools: [],
}

describe('ovhModel', () => {
  it('POSTs to the operator-supplied modelEndpoint', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      okResponse({
        choices: [{ finish_reason: 'stop', message: { content: 'bonjour' } }],
        usage: { prompt_tokens: 3, completion_tokens: 2 },
      }),
    )
    const endpoint =
      'https://mixtral-8x7b-instruct.endpoints.kepler.ai.cloud.ovh.net/api/openai_compat/v1/chat/completions'
    const model = ovhModel({ apiKey: 'ovh-k', modelEndpoint: endpoint, fetchImpl })
    expect(model.providerName).toBe('ovh')
    expect(model.residency).toBe('eu')
    const step = await model.generate(baseInput)
    expect(step.content).toBe('bonjour')
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(endpoint)
    const headers = init.headers as Record<string, string>
    expect(headers['authorization']).toBe('Bearer ovh-k')
  })

  it('honours an explicit model name override', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      okResponse({
        choices: [{ finish_reason: 'stop', message: { content: '' } }],
        usage: { prompt_tokens: 0, completion_tokens: 0 },
      }),
    )
    const model = ovhModel({
      apiKey: 'k',
      modelEndpoint: 'https://example.endpoints.ai.cloud.ovh.net/api/openai_compat/v1/chat/completions',
      model: 'llama-3.3-70b',
      fetchImpl,
    })
    expect(model.modelName).toBe('llama-3.3-70b')
    await model.generate(baseInput)
    const init = fetchImpl.mock.calls[0]![1]
    const body = JSON.parse(String(init.body))
    expect(body.model).toBe('llama-3.3-70b')
  })
})
