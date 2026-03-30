import { createHash } from 'node:crypto'
import { configure, guard, BudgetExceeded } from 'fuze-ai'

// Configure: $1.00 run ceiling. The built-in pricing for gpt-4o is used.
// Fuze auto-extracts cost from the OpenAI-shaped usage data returned by each call.
configure({
  defaults: {
    maxCostPerRun: 1.00,
  },
})

// Simulates an LLM-powered analysis step: hashes a chunk and returns an
// OpenAI-shaped response so Fuze can auto-extract cost from usage data.
async function analyseChunk(chunk: string): Promise<{ result: string; usage: { prompt_tokens: number; completion_tokens: number }; model: string }> {
  // Do real work: compute a SHA-256 hash of the input
  const hash = createHash('sha256').update(chunk).digest('hex')
  return {
    result: `Chunk "${chunk}" analysed: sha256=${hash.slice(0, 16)}...`,
    usage: { prompt_tokens: 40_000, completion_tokens: 18_000 },
    model: 'gpt-4o',
  }
}

const protectedAnalyse = guard(analyseChunk, {
  maxCost: 0.50,           // per-step ceiling ($0.50)
  model: 'openai/gpt-4o', // pricing table; cost auto-extracted from response usage
})

async function main() {
  console.log('Fuze AI -- Budget Ceiling Example\n')
  console.log('Run ceiling : $1.00')
  console.log('Step ceiling: $0.50')
  console.log('Cost/call   : auto-extracted from response usage (gpt-4o pricing)\n')

  const chunks = ['quarterly-report', 'customer-feedback', 'incident-log', 'roadmap-draft', 'compliance-audit']

  for (let i = 0; i < chunks.length; i++) {
    try {
      const response = await protectedAnalyse(chunks[i])
      console.log(`Step ${i + 1} OK  : ${response.result}`)
    } catch (err) {
      if (err instanceof BudgetExceeded) {
        console.log(`Step ${i + 1} BLOCKED: ${err.message}`)
        console.log(`  level    : ${err.level}`)
        console.log(`  estimated: $${err.estimatedCost.toFixed(4)}`)
        console.log(`  ceiling  : $${err.ceiling.toFixed(4)}`)
        console.log(`  spent    : $${err.spent.toFixed(4)}`)
        console.log('\nBudget enforcement prevented runaway spend.')
        break
      }
      throw err
    }
  }

  console.log('\nCheck ./fuze-traces.jsonl for cost details per step.')
}

main().catch(console.error)
