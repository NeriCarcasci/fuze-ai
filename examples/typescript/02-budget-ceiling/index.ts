import { createHash } from 'node:crypto'
import { configure, guard, ResourceLimitExceeded } from 'fuze-ai'

// Configure: 100k-token run ceiling. Once combined input+output crosses this
// line, the next step that trips the check throws ResourceLimitExceeded.
configure({
  resourceLimits: {
    maxTokensPerRun: 100_000,
  },
})

// Simulates an LLM-powered analysis step. The return value carries OpenAI-shaped
// usage data; Fuze auto-extracts tokensIn/tokensOut from it.
async function analyseChunk(chunk: string): Promise<{ result: string; usage: { prompt_tokens: number; completion_tokens: number }; model: string }> {
  const hash = createHash('sha256').update(chunk).digest('hex')
  return {
    result: `Chunk "${chunk}" analysed: sha256=${hash.slice(0, 16)}...`,
    usage: { prompt_tokens: 40_000, completion_tokens: 18_000 },
    model: 'gpt-4o',
  }
}

const protectedAnalyse = guard(analyseChunk)

async function main() {
  console.log('Fuze AI -- Token Ceiling Example\n')
  console.log('Run ceiling : 100,000 tokens (input + output combined)')
  console.log('Per call    : ~58,000 tokens (auto-extracted from response.usage)\n')

  const chunks = ['quarterly-report', 'customer-feedback', 'incident-log', 'roadmap-draft', 'compliance-audit']

  for (let i = 0; i < chunks.length; i++) {
    try {
      const response = await protectedAnalyse(chunks[i])
      console.log(`Step ${i + 1} OK     : ${response.result}`)
    } catch (err) {
      if (err instanceof ResourceLimitExceeded) {
        console.log(`Step ${i + 1} BLOCKED: ${err.message}`)
        console.log(`  limit    : ${err.details.limit}`)
        console.log(`  observed : ${err.details.observed}`)
        console.log(`  ceiling  : ${err.details.ceiling}`)
        console.log('\nResource-limit enforcement prevented runaway token usage.')
        break
      }
      throw err
    }
  }

  console.log('\nCheck ./fuze-traces.jsonl for per-step token usage.')
}

main().catch(console.error)
