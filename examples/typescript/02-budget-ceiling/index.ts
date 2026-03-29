import { configure, guard, BudgetExceeded } from 'fuze-ai'

// Set a $1.00 run ceiling and configure a provider so Fuze can estimate costs.
configure({
  defaults: {
    maxCostPerRun: 1.00,
  },
  providers: {
    'openai/gpt-4o': { input: 0.0025, output: 0.01 },
  },
})

// Simulates an LLM-powered analysis step that costs ~$0.28 per call
// (800 input tokens * $0.0025/1K + 200 output tokens * $0.01/1K = $0.002 + $0.002 = $0.004)
// We set maxCost: 0.30 as the per-step ceiling.
async function analyseChunk(chunk: string): Promise<string> {
  await new Promise(r => setTimeout(r, 100))
  return `Analysis of "${chunk}": looks good.`
}

const protectedAnalyse = guard(analyseChunk, {
  maxCost: 0.30,
  model: 'openai/gpt-4o',
  estimatedTokensIn: 80_000,
  estimatedTokensOut: 20_000,
})

async function main() {
  console.log('Fuze AI — Budget Ceiling Example\n')
  console.log('Run ceiling : $1.00')
  console.log('Step ceiling: $0.30')
  console.log('Est. cost/call: ~$0.40 (80K in + 20K out at gpt-4o rates)\n')

  const chunks = ['chunk-A', 'chunk-B', 'chunk-C', 'chunk-D', 'chunk-E']

  for (let i = 0; i < chunks.length; i++) {
    try {
      const result = await protectedAnalyse(chunks[i])
      console.log(`Step ${i + 1} OK:`, result)
    } catch (err) {
      if (err instanceof BudgetExceeded) {
        console.log(`Step ${i + 1} BLOCKED: ${err.message}`)
        console.log(`  level    : ${err.level}`)
        console.log(`  estimated: $${err.estimatedCost.toFixed(4)}`)
        console.log(`  ceiling  : $${err.ceiling.toFixed(4)}`)
        console.log(`  spent    : $${err.spent.toFixed(4)}`)
      } else {
        throw err
      }
    }
  }

  console.log('\nDone. Budget enforcement prevented runaway spend.')
}

main().catch(console.error)
