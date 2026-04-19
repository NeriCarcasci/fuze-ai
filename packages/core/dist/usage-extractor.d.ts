/**
 * Token usage extracted from an LLM response object.
 */
export interface ExtractedUsage {
    tokensIn: number;
    tokensOut: number;
    /** Model name from the response, if available. */
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
//# sourceMappingURL=usage-extractor.d.ts.map