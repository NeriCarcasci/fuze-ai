import { describe, expect, it, vi } from 'vitest'
import type { ModelGenerateInput } from '@fuze-ai/agent'
import { scalewayModel } from '../src/scaleway.js'
import type { FetchLike } from '../src/openai-compat.js'

const okResponse = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })

const baseInput: ModelGenerateInput = {
  messages: [{ role: 'user', content: 'hi' }],
  tools: [],
}

describe('scalewayModel', () => {
  it('builds a project-scoped URL and sends bearer auth', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      okResponse({
        choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
    )
    const model = scalewayModel({
      apiKey: 'scw-key',
      model: 'llama-3.1-70b-instruct',
      projectId: 'proj-abc',
      fetchImpl,
    })
    await model.generate(baseInput)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe('https://api.scaleway.ai/proj-abc/v1/chat/completions')
    const headers = init.headers as Record<string, string>
    expect(headers['authorization']).toBe('Bearer scw-key')
    expect(model.providerName).toBe('scaleway')
    expect(model.residency).toBe('eu')
  })

  it('parses tool_calls in responses', async () => {
    const fetchImpl = vi.fn<FetchLike>().mockResolvedValue(
      okResponse({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: '',
              tool_calls: [
                {
                  id: 'c1',
                  function: { name: 'fn', arguments: '{"q":"yo"}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      }),
    )
    const model = scalewayModel({
      apiKey: 'k',
      model: 'm',
      projectId: 'p',
      fetchImpl,
    })
    const step = await model.generate(baseInput)
    expect(step.finishReason).toBe('tool_calls')
    expect(step.toolCalls).toEqual([
      { id: 'c1', name: 'fn', args: { q: 'yo' } },
    ])
  })
})
