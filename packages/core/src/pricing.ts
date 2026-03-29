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
