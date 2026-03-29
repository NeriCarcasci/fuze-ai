/**
 * Minimal LLM usage extractor for the proxy.
 * Mirrors the logic in packages/core/src/pricing.ts — kept local to avoid a
 * daemon → core dependency.
 */
export interface ProxyExtractedUsage {
    tokensIn: number;
    tokensOut: number;
    model?: string;
}
/**
 * Inspects an MCP tool-call result for embedded LLM token usage.
 * Returns null if no recognised usage shape is found.
 */
export declare function extractUsageFromResult(result: unknown): ProxyExtractedUsage | null;
//# sourceMappingURL=extract-usage.d.ts.map