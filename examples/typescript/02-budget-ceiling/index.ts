// Fuze AI — Example 02: Budget Ceiling
//
// Configure a per-run token ceiling, then make repeated guarded calls.
// Once the cumulative input + output token count crosses the ceiling,
// the next call throws ResourceLimitExceeded.

import { configure, guard, ResourceLimitExceeded } from 'fuze-ai'

configure({
  resourceLimits: { maxTokensPerRun: 100_000 },
})

async function analyse(chunk: string): Promise<{
  result: string
  usage: { prompt_tokens: number; completion_tokens: number }
  model: string
}> {
  return {
    result: `analysed "${chunk}"`,
    usage: { prompt_tokens: 40_000, completion_tokens: 18_000 },
    model: 'gpt-4o',
  }
}

const guardedAnalyse = guard(analyse)

async function main(): Promise<void> {
  console.log('Fuze AI — Budget Ceiling\n')
  console.log('  ceiling : 100,000 tokens (input + output combined)')
  console.log('  per call: ~58,000 tokens (auto-extracted from usage)\n')

  const chunks = ['report', 'feedback', 'incidents', 'roadmap', 'audit']

  for (let i = 0; i < chunks.length; i++) {
    try {
      const r = await guardedAnalyse(chunks[i])
      console.log(`  step ${i + 1}: ok — ${r.result}`)
    } catch (err) {
      if (err instanceof ResourceLimitExceeded) {
        console.log(`  step ${i + 1}: BLOCKED — ${err.message}`)
        console.log(`    observed: ${err.details.observed} / ${err.details.ceiling}`)
        break
      }
      throw err
    }
  }

  console.log('\nTrace: ./fuze-traces.jsonl')
}

main().catch(console.error)
