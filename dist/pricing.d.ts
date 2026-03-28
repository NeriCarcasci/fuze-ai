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
export {};
//# sourceMappingURL=pricing.d.ts.map