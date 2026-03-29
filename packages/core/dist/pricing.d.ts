interface ModelPrice {
    input: number;
    output: number;
}
/**
 * Merges user-provided pricing overrides into the registry.
 * @param overrides - Map of model identifiers to price objects.
 */
export declare function mergePricing(overrides: Record<string, ModelPrice>): void;
/**
 * Looks up the per-token price for a model.
 * @param model - Model identifier (e.g., 'openai/gpt-4o').
 * @returns The input/output price per token, or null if unknown.
 */
export declare function getModelPrice(model: string): ModelPrice | null;
/**
 * Estimates the cost of a model call given token counts.
 * @param model - Model identifier.
 * @param tokensIn - Number of input tokens.
 * @param tokensOut - Number of output tokens.
 * @returns Estimated cost in USD. Returns 0 if model is unknown.
 */
export declare function estimateCost(model: string, tokensIn: number, tokensOut: number): number;
/**
 * Resets the pricing registry (used in testing).
 */
export declare function resetPricing(): void;
/**
 * Token usage extracted from an LLM response object.
 */
export interface ExtractedUsage {
    tokensIn: number;
    tokensOut: number;
    /** Model name from the response, if available (used for cost lookup). */
    model?: string;
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
export declare function extractUsageFromResult(result: unknown): ExtractedUsage | null;
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
export declare function estimateFromArgs(args: unknown[], model?: string): number;
export {};
//# sourceMappingURL=pricing.d.ts.map