import { createRun } from 'fuze-ai'
import { fakeLLM } from '../llm-stub.js'

const SEARCH_DB: Record<string, string[]> = {
  'AI safety regulations': [
    'EU AI Act enforcement begins August 2026',
    'NIST AI Risk Management Framework published',
    'Singapore publishes agentic AI governance guidelines',
  ],
  'AI agent cost incidents': [
    '$1.6M weekend bill from retry loop (GeekFence incident)',
    '$47K from two agents ping-ponging without budget limits',
    'Fortune 500 accrues $400M unbudgeted cloud spend from agents',
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
    { model: 'openai/gpt-4o' }, // Fuze will auto-extract cost from response.usage
  )
}
