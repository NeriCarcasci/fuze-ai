import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
let priceRegistry = null;
/**
 * Loads the built-in provider pricing data from disk.
 * @returns The pricing registry keyed by model identifier.
 */
function loadPricing() {
    if (priceRegistry)
        return priceRegistry;
    const pricingPath = join(__dirname, '..', 'data', 'provider-pricing.json');
    const raw = readFileSync(pricingPath, 'utf-8');
    priceRegistry = JSON.parse(raw);
    return priceRegistry;
}
/**
 * Merges user-provided pricing overrides into the registry.
 * @param overrides - Map of model identifiers to price objects.
 */
export function mergePricing(overrides) {
    const registry = loadPricing();
    for (const [model, price] of Object.entries(overrides)) {
        registry[model] = price;
    }
}
/**
 * Looks up the per-token price for a model.
 * @param model - Model identifier (e.g., 'openai/gpt-4o').
 * @returns The input/output price per token, or null if unknown.
 */
export function getModelPrice(model) {
    const registry = loadPricing();
    return registry[model] ?? null;
}
/**
 * Estimates the cost of a model call given token counts.
 * @param model - Model identifier.
 * @param tokensIn - Number of input tokens.
 * @param tokensOut - Number of output tokens.
 * @returns Estimated cost in USD. Returns 0 if model is unknown.
 */
export function estimateCost(model, tokensIn, tokensOut) {
    const price = getModelPrice(model);
    if (!price)
        return 0;
    return price.input * tokensIn + price.output * tokensOut;
}
/**
 * Resets the pricing registry (used in testing).
 */
export function resetPricing() {
    priceRegistry = null;
}
//# sourceMappingURL=pricing.js.map