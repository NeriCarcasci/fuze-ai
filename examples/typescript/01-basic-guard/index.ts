// Fuze AI — Example 01: Basic Guard
//
// Wrap an async tool with `guard()` once, then call it as if it were the
// original function. Every call is traced; tokens are auto-extracted from
// OpenAI-shaped `usage` payloads.

import { guard } from 'fuze-ai'

// Pretend this calls an LLM. The shape of the return value lets Fuze
// auto-extract token counts without any extractor config.
async function classify(text: string): Promise<{
  result: 'short' | 'long'
  usage: { prompt_tokens: number; completion_tokens: number }
  model: string
}> {
  return {
    result: text.length > 50 ? 'long' : 'short',
    usage: { prompt_tokens: Math.ceil(text.length / 4), completion_tokens: 4 },
    model: 'gpt-4o',
  }
}

// Wrap once. `guarded` has the same signature as `classify`.
const guarded = guard(classify)

async function main(): Promise<void> {
  console.log('Fuze AI — Basic Guard\n')

  const samples = [
    'hello',
    'a much longer piece of text that exceeds fifty characters end-to-end',
    'short again',
  ]

  for (const text of samples) {
    const r = await guarded(text)
    const total = r.usage.prompt_tokens + r.usage.completion_tokens
    console.log(`  ${r.result.padEnd(6)} — ${total.toString().padStart(3)} tokens`)
  }

  console.log('\nTrace: ./fuze-traces.jsonl')
}

main().catch(console.error)
