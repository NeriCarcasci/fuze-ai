import { describe, it, expect } from 'vitest'
import { extractUsageFromResult } from '../src/pricing.js'

describe('extractUsageFromResult()', () => {
  it('returns null for null', () => {
    expect(extractUsageFromResult(null)).toBeNull()
  })

  it('returns null for a plain string', () => {
    expect(extractUsageFromResult('hello')).toBeNull()
  })

  it('returns null for a plain array', () => {
    expect(extractUsageFromResult([1, 2, 3])).toBeNull()
  })

  it('returns null for an object without usage', () => {
    expect(extractUsageFromResult({ data: 'foo', id: 'bar' })).toBeNull()
  })

  it('parses OpenAI / OpenRouter shape (usage.prompt_tokens)', () => {
    const result = extractUsageFromResult({
      id: 'chatcmpl-abc',
      model: 'gpt-4o',
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
    })
    expect(result).toEqual({ tokensIn: 100, tokensOut: 50, model: 'gpt-4o' })
  })

  it('parses OpenAI shape with zero completion tokens', () => {
    const result = extractUsageFromResult({
      model: 'gpt-4o-mini',
      usage: { prompt_tokens: 200, total_tokens: 200 },
    })
    expect(result).toEqual({ tokensIn: 200, tokensOut: 0, model: 'gpt-4o-mini' })
  })

  it('parses Anthropic shape (usage.input_tokens)', () => {
    const result = extractUsageFromResult({
      model: 'claude-opus-4-6',
      usage: { input_tokens: 300, output_tokens: 120 },
    })
    expect(result).toEqual({ tokensIn: 300, tokensOut: 120, model: 'claude-opus-4-6' })
  })

  it('parses Google Gemini shape (usageMetadata.promptTokenCount)', () => {
    const result = extractUsageFromResult({
      modelVersion: 'gemini-1.5-pro',
      usageMetadata: { promptTokenCount: 400, candidatesTokenCount: 180 },
    })
    expect(result).toEqual({ tokensIn: 400, tokensOut: 180, model: 'gemini-1.5-pro' })
  })

  it('parses Vercel AI SDK / Mastra shape (usage.promptTokens)', () => {
    const result = extractUsageFromResult({
      text: 'Hello world',
      usage: { promptTokens: 50, completionTokens: 25 },
    })
    expect(result).toEqual({ tokensIn: 50, tokensOut: 25 })
  })

  it('parses LangChain AIMessage shape (usage_metadata.input_tokens)', () => {
    const result = extractUsageFromResult({
      content: 'Hello',
      usage_metadata: { input_tokens: 80, output_tokens: 40 },
      response_metadata: { model_name: 'gpt-4o' },
    })
    expect(result).toEqual({ tokensIn: 80, tokensOut: 40, model: 'gpt-4o' })
  })

  it('parses LangChain legacy ChatResult shape (llm_output.token_usage.prompt_tokens)', () => {
    const result = extractUsageFromResult({
      generations: [],
      llm_output: {
        model_name: 'gpt-3.5-turbo',
        token_usage: { prompt_tokens: 60, completion_tokens: 30 },
      },
    })
    expect(result).toEqual({ tokensIn: 60, tokensOut: 30, model: 'gpt-3.5-turbo' })
  })

  it('parses AWS Bedrock shape (usage.inputTokens)', () => {
    const result = extractUsageFromResult({
      modelId: 'anthropic.claude-v2',
      usage: { inputTokens: 250, outputTokens: 100 },
    })
    expect(result).toEqual({ tokensIn: 250, tokensOut: 100, model: 'anthropic.claude-v2' })
  })

  it('parses Cohere shape (meta.tokens.input_tokens)', () => {
    const result = extractUsageFromResult({
      meta: { tokens: { input_tokens: 90, output_tokens: 45 } },
    })
    expect(result).toEqual({ tokensIn: 90, tokensOut: 45 })
  })

  it('OpenRouter response uses same shape as OpenAI (prompt_tokens)', () => {
    // OpenRouter normalises to OpenAI-compatible format
    const result = extractUsageFromResult({
      model: 'openai/gpt-4o',
      usage: { prompt_tokens: 150, completion_tokens: 75 },
    })
    expect(result).toEqual({ tokensIn: 150, tokensOut: 75, model: 'openai/gpt-4o' })
  })

  it('extracts model name when present in OpenAI response', () => {
    const result = extractUsageFromResult({
      model: 'gpt-4o-2024-11-20',
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })
    expect(result?.model).toBe('gpt-4o-2024-11-20')
  })

  it('returns undefined model when not in response', () => {
    const result = extractUsageFromResult({
      usage: { promptTokens: 10, completionTokens: 5 },
    })
    expect(result?.model).toBeUndefined()
  })
})

