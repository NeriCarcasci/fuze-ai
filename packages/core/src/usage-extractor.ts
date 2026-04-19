// Reads token counts from known LLM response shapes.
// Pure telemetry — no pricing, no currency conversion.

/**
 * Token usage extracted from an LLM response object.
 */
export interface ExtractedUsage {
  tokensIn: number
  tokensOut: number
  /** Model name from the response, if available. */
  model?: string
}

/**
 * Inspects a return value and extracts token usage from known LLM response shapes.
 *
 * Supports: OpenAI / OpenRouter / Azure / Together / Fireworks / Perplexity / Mistral / LiteLLM,
 * Anthropic, Google Gemini, Vercel AI SDK / Mastra, LangChain AIMessage,
 * LangChain legacy ChatResult, AWS Bedrock, Cohere.
 *
 * @returns Extracted usage or null if the value is not a recognised LLM response.
 */
export function extractUsageFromResult(result: unknown): ExtractedUsage | null {
  if (!result || typeof result !== 'object') return null
  const r = result as Record<string, unknown>

  const usage = r.usage as Record<string, unknown> | undefined

  // 1. OpenAI / OpenRouter / Azure / Together / Fireworks / Perplexity / Mistral / LiteLLM
  //    { usage: { prompt_tokens, completion_tokens }, model? }
  if (typeof usage?.prompt_tokens === 'number') {
    return {
      tokensIn: usage.prompt_tokens,
      tokensOut: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0,
      model: typeof r.model === 'string' ? r.model : undefined,
    }
  }

  // 2. Anthropic  { usage: { input_tokens, output_tokens }, model? }
  if (typeof usage?.input_tokens === 'number') {
    return {
      tokensIn: usage.input_tokens,
      tokensOut: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
      model: typeof r.model === 'string' ? r.model : undefined,
    }
  }

  // 3. Google Gemini  { usageMetadata: { promptTokenCount, candidatesTokenCount }, modelVersion? }
  const usageMetadata = r.usageMetadata as Record<string, unknown> | undefined
  if (typeof usageMetadata?.promptTokenCount === 'number') {
    return {
      tokensIn: usageMetadata.promptTokenCount,
      tokensOut: typeof usageMetadata.candidatesTokenCount === 'number' ? usageMetadata.candidatesTokenCount : 0,
      model: typeof r.modelVersion === 'string' ? r.modelVersion : undefined,
    }
  }

  // 4. Vercel AI SDK / Mastra  { usage: { promptTokens, completionTokens } }
  if (typeof usage?.promptTokens === 'number') {
    return {
      tokensIn: usage.promptTokens,
      tokensOut: typeof usage.completionTokens === 'number' ? usage.completionTokens : 0,
    }
  }

  // 5. LangChain AIMessage  { usage_metadata: { input_tokens, output_tokens }, response_metadata? }
  const usageMeta = r.usage_metadata as Record<string, unknown> | undefined
  if (typeof usageMeta?.input_tokens === 'number') {
    const responseMeta = r.response_metadata as Record<string, unknown> | undefined
    return {
      tokensIn: usageMeta.input_tokens,
      tokensOut: typeof usageMeta.output_tokens === 'number' ? usageMeta.output_tokens : 0,
      model: typeof responseMeta?.model_name === 'string' ? responseMeta.model_name : undefined,
    }
  }

  // 6. LangChain legacy ChatResult  { llm_output: { token_usage: { prompt_tokens, completion_tokens }, model_name? } }
  const llmOutput = r.llm_output as Record<string, unknown> | undefined
  const tokenUsage = llmOutput?.token_usage as Record<string, unknown> | undefined
  if (typeof tokenUsage?.prompt_tokens === 'number') {
    return {
      tokensIn: tokenUsage.prompt_tokens,
      tokensOut: typeof tokenUsage.completion_tokens === 'number' ? tokenUsage.completion_tokens : 0,
      model: typeof llmOutput?.model_name === 'string' ? llmOutput.model_name : undefined,
    }
  }

  // 7. AWS Bedrock  { usage: { inputTokens, outputTokens }, modelId? }
  if (typeof usage?.inputTokens === 'number') {
    return {
      tokensIn: usage.inputTokens,
      tokensOut: typeof usage.outputTokens === 'number' ? usage.outputTokens : 0,
      model: typeof r.modelId === 'string' ? r.modelId : undefined,
    }
  }

  // 8. Cohere  { meta: { tokens: { input_tokens, output_tokens } } }
  const meta = r.meta as Record<string, unknown> | undefined
  const metaTokens = meta?.tokens as Record<string, unknown> | undefined
  if (typeof metaTokens?.input_tokens === 'number') {
    return {
      tokensIn: metaTokens.input_tokens,
      tokensOut: typeof metaTokens.output_tokens === 'number' ? metaTokens.output_tokens : 0,
    }
  }

  return null
}
