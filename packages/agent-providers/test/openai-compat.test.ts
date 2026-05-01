import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineTool } from '@fuze-ai/agent'
import { Ok } from '@fuze-ai/agent'
import type { ModelGenerateInput, ThreatBoundary, RetentionPolicy } from '@fuze-ai/agent'
import {
  buildChatRequest,
  parseChatResponse,
  toolToOpenAi,
} from '../src/openai-compat.js'

const TB: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

const RET: RetentionPolicy = {
  id: 'test.v1',
  hashTtlDays: 30,
  fullContentTtlDays: 7,
  decisionTtlDays: 90,
}

const lookupTool = defineTool.public({
  name: 'lookup',
  description: 'looks up a record by id',
  input: z.object({
    id: z.string(),
    limit: z.number().optional(),
    deep: z.boolean(),
  }),
  output: z.object({ found: z.boolean() }),
  threatBoundary: TB,
  retention: RET,
  run: async () => Ok({ found: true }),
})

describe('openai-compat', () => {
  it('builds a request with model, messages, tools, and max_tokens', () => {
    const input: ModelGenerateInput = {
      messages: [
        { role: 'system', content: 'be terse' },
        { role: 'user', content: 'hello' },
      ],
      tools: [lookupTool],
      maxOutputTokens: 256,
    }
    const req = buildChatRequest('m-1', input)
    expect(req.model).toBe('m-1')
    expect(req.messages).toHaveLength(2)
    expect(req.messages[0]).toEqual({ role: 'system', content: 'be terse' })
    expect(req.tools).toHaveLength(1)
    expect(req.max_tokens).toBe(256)
  })

  it('converts a z.object tool input to JSON schema with required fields', () => {
    const def = toolToOpenAi(lookupTool)
    expect(def.type).toBe('function')
    expect(def.function.name).toBe('lookup')
    expect(def.function.parameters.type).toBe('object')
    expect(def.function.parameters.properties).toEqual({
      id: { type: 'string' },
      limit: { type: 'number' },
      deep: { type: 'boolean' },
    })
    expect(def.function.parameters.required.slice().sort()).toEqual(['deep', 'id'])
  })

  it('parses a response with content and tool_calls', () => {
    const step = parseChatResponse({
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            content: 'thinking',
            tool_calls: [
              {
                id: 'call_a',
                type: 'function',
                function: { name: 'lookup', arguments: '{"id":"x","deep":true}' },
              },
            ],
          },
        },
      ],
      usage: { prompt_tokens: 7, completion_tokens: 3 },
    })
    expect(step.content).toBe('thinking')
    expect(step.toolCalls).toHaveLength(1)
    expect(step.toolCalls[0]).toEqual({
      id: 'call_a',
      name: 'lookup',
      args: { id: 'x', deep: true },
    })
    expect(step.finishReason).toBe('tool_calls')
    expect(step.tokensIn).toBe(7)
    expect(step.tokensOut).toBe(3)
  })

  it('parses a response with stop finish reason and no tool calls', () => {
    const step = parseChatResponse({
      choices: [
        {
          finish_reason: 'stop',
          message: { content: 'done' },
        },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    })
    expect(step.finishReason).toBe('stop')
    expect(step.toolCalls).toEqual([])
    expect(step.content).toBe('done')
  })

  it('omits tools and max_tokens when not provided', () => {
    const input: ModelGenerateInput = {
      messages: [{ role: 'user', content: 'hi' }],
      tools: [],
    }
    const req = buildChatRequest('m-2', input)
    expect(req.tools).toBeUndefined()
    expect(req.max_tokens).toBeUndefined()
  })
})
