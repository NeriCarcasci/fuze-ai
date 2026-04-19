import { createRun } from 'fuze-ai'
import { fakeLLM } from '../llm-stub.js'

const SEARCH_DB: Record<string, string[]> = {
  'AI safety regulations': [
    'EU AI Act enforcement begins August 2026',
    'NIST AI Risk Management Framework published',
    'Singapore publishes agentic AI governance guidelines',
  ],
  'AI agent runaway incidents': [
    'Retry loop burned 1.6M extra tokens overnight (GeekFence incident)',
    'Two agents ping-ponging without limits consumed 47K tokens before kill',
    'Fortune 500 logs runaway agents producing sustained unbounded tool calls',
  ],
}

export function makeWebSearch(run: ReturnType<typeof createRun>) {
  return run.guard(
    async function webSearch(query: unknown): Promise<{
      results: string[]
      source: string
      content: string
      model: string
      usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
    }> {
      await new Promise(r => setTimeout(r, 100))

      const results = SEARCH_DB[query as string] ?? [`Generic result for: ${query}`]

      // Simulate using an LLM to process results — returns usage metadata
      const llmResponse = await fakeLLM(
        `Summarise search results for: ${query}`,
        { tokensIn: 200, tokensOut: 100 },
      )

      return {
        results,
        source: 'web',
        content: llmResponse.content,
        model: llmResponse.model,
        usage: llmResponse.usage,
      }
    },
  )
}
