import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

interface ModelPrice {
  input: number
  output: number
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

let priceRegistry: Record<string, ModelPrice> | null = null

/**
 * Loads the built-in provider pricing data from disk.
 * @returns The pricing registry keyed by model identifier.
 */
function loadPricing(): Record<string, ModelPrice> {
  if (priceRegistry) return priceRegistry

  const pricingPath = join(__dirname, '..', 'data', 'provider-pricing.json')
  const raw = readFileSync(pricingPath, 'utf-8')
  priceRegistry = JSON.parse(raw) as Record<string, ModelPrice>
  return priceRegistry
}

/**
 * Merges user-provided pricing overrides into the registry.
 * @param overrides - Map of model identifiers to price objects.
 */
export function mergePricing(overrides: Record<string, ModelPrice>): void {
  const registry = loadPricing()
  for (const [model, price] of Object.entries(overrides)) {
    registry[model] = price
  }
}

/**
 * Looks up the per-token price for a model.
 * @param model - Model identifier (e.g., 'openai/gpt-4o').
 * @returns The input/output price per token, or null if unknown.
 */
export function getModelPrice(model: string): ModelPrice | null {
  const registry = loadPricing()
  return registry[model] ?? null
}

/**
 * Estimates the cost of a model call given token counts.
 * @param model - Model identifier.
 * @param tokensIn - Number of input tokens.
 * @param tokensOut - Number of output tokens.
 * @returns Estimated cost in USD. Returns 0 if model is unknown.
 */
export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const price = getModelPrice(model)
  if (!price) return 0
  return price.input * tokensIn + price.output * tokensOut
}

/**
 * Resets the pricing registry (used in testing).
 */
export function resetPricing(): void {
  priceRegistry = null
}

// ── Auto cost extraction ───────────────────────────────────────────────────────

/**
 * Token usage extracted from an LLM response object.
 */
export interface ExtractedUsage {
  tokensIn: number
  tokensOut: number
  /** Model name from the response, if available (used for cost lookup). */
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

/**
 * Estimates cost from serialised args size when no explicit token counts are given.
 *
 * Uses a 4-chars-per-token heuristic for input, 50% of input for output.
 * Falls back to a conservative $0.00001/token flat rate if the model is unknown.
 *
 * @param args - Function arguments to estimate from.
 * @param model - Model identifier (optional). Used for pricing lookup.
 * @returns Estimated cost in USD.
 */
export function estimateFromArgs(args: unknown[], model?: string): number {
  let argsStr: string
  try {
    argsStr = JSON.stringify(args)
  } catch {
    argsStr = String(args)
  }
  const estimatedInputTokens = Math.ceil(argsStr.length / 4)
  const estimatedOutputTokens = Math.ceil(estimatedInputTokens * 0.5)

  if (model) {
    const cost = estimateCost(model, estimatedInputTokens, estimatedOutputTokens)
    if (cost > 0) return cost
  }
  // No model or unknown model — conservative flat rate
  return (estimatedInputTokens + estimatedOutputTokens) * 0.00001
}
