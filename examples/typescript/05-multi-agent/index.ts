// Fuze AI — Example 05: Multi-Agent Shared Run
//
// `createRun()` opens a run context. Tools wrapped with `run.guard()`
// share its loop detector and resource ceiling — different tools, one
// budget, one trace.

import { configure, createRun } from 'fuze-ai'

configure({
  resourceLimits: { maxTokensPerRun: 50_000 },
})

// --- Researcher agent tools ---

async function webSearch(query: string): Promise<{
  result: string[]
  usage: { prompt_tokens: number; completion_tokens: number }
  model: string
}> {
  return {
    result: [`hit-1 for "${query}"`, `hit-2 for "${query}"`],
    usage: { prompt_tokens: 2_000, completion_tokens: 500 },
    model: 'gpt-4o',
  }
}

async function summarise(docs: string[]): Promise<{
  result: string
  usage: { prompt_tokens: number; completion_tokens: number }
  model: string
}> {
  return {
    result: `summary of ${docs.length} docs`,
    usage: { prompt_tokens: 3_000, completion_tokens: 800 },
    model: 'gpt-4o',
  }
}

// --- Writer agent tools ---

async function draft(summary: string, tone: string): Promise<{
  result: string
  usage: { prompt_tokens: number; completion_tokens: number }
  model: string
}> {
  return {
    result: `[draft|${tone}] ${summary}`,
    usage: { prompt_tokens: 4_000, completion_tokens: 2_000 },
    model: 'gpt-4o',
  }
}

async function editDraft(text: string): Promise<{
  result: string
  usage: { prompt_tokens: number; completion_tokens: number }
  model: string
}> {
  return {
    result: text.replace('draft', 'final'),
    usage: { prompt_tokens: 2_000, completion_tokens: 1_500 },
    model: 'gpt-4o',
  }
}

async function main(): Promise<void> {
  const run = createRun('research-team')
  console.log('Fuze AI — Multi-Agent Shared Run')
  console.log(`  runId  : ${run.runId}`)
  console.log(`  ceiling: 50,000 tokens (shared across all agents)\n`)

  const search = run.guard(webSearch)
  const summary = run.guard(summarise)
  const drafter = run.guard(draft)
  const editor = run.guard(editDraft)

  console.log('=== Researcher ===')
  const hits = await search('budget enforcement')
  console.log(`  search : ${hits.result.length} hits`)
  const sum = await summary(hits.result)
  console.log(`  summary: ${sum.result}`)

  console.log('\n=== Writer ===')
  const d = await drafter(sum.result, 'technical')
  console.log(`  draft  : ${d.result}`)
  const e = await editor(d.result)
  console.log(`  final  : ${e.result}`)

  const status = run.getStatus()
  const used = status.totalTokensIn + status.totalTokensOut
  console.log('\n=== Run Status ===')
  console.log(`  steps     : ${status.stepCount}`)
  console.log(`  tokens    : ${status.totalTokensIn} in + ${status.totalTokensOut} out`)
  console.log(`  remaining : ${Math.max(0, 50_000 - used)} tokens`)

  await run.end()
  console.log('\nTrace: ./fuze-traces.jsonl')
}

main().catch(console.error)
