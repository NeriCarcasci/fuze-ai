/**
 * Minimal LLM usage extractor for the proxy.
 * Mirrors the logic in packages/core/src/pricing.ts — kept local to avoid a
 * daemon → core dependency.
 */
/**
 * Inspects an MCP tool-call result for embedded LLM token usage.
 * Returns null if no recognised usage shape is found.
 */
export function extractUsageFromResult(result) {
    if (!result || typeof result !== 'object')
        return null;
    const r = result;
    const usage = r.usage;
    // OpenAI / OpenRouter / Mistral / LiteLLM
    if (typeof usage?.prompt_tokens === 'number') {
        return {
            tokensIn: usage.prompt_tokens,
            tokensOut: typeof usage.completion_tokens === 'number' ? usage.completion_tokens : 0,
            model: typeof r.model === 'string' ? r.model : undefined,
        };
    }
    // Anthropic
    if (typeof usage?.input_tokens === 'number') {
        return {
            tokensIn: usage.input_tokens,
            tokensOut: typeof usage.output_tokens === 'number' ? usage.output_tokens : 0,
            model: typeof r.model === 'string' ? r.model : undefined,
        };
    }
    // Google Gemini
    const usageMeta = r.usageMetadata;
    if (typeof usageMeta?.promptTokenCount === 'number') {
        return {
            tokensIn: usageMeta.promptTokenCount,
            tokensOut: typeof usageMeta.candidatesTokenCount === 'number' ? usageMeta.candidatesTokenCount : 0,
            model: typeof r.modelVersion === 'string' ? r.modelVersion : undefined,
        };
    }
    // Vercel AI SDK / Mastra
    if (typeof usage?.promptTokens === 'number') {
        return {
            tokensIn: usage.promptTokens,
            tokensOut: typeof usage.completionTokens === 'number' ? usage.completionTokens : 0,
        };
    }
    // AWS Bedrock
    if (typeof usage?.inputTokens === 'number') {
        return {
            tokensIn: usage.inputTokens,
            tokensOut: typeof usage.outputTokens === 'number' ? usage.outputTokens : 0,
            model: typeof r.modelId === 'string' ? r.modelId : undefined,
        };
    }
    return null;
}
//# sourceMappingURL=extract-usage.js.map