import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { configure, createRun } from 'fuze-ai'

// Set a shared budget ceiling for all runs in this session.
// createRun() inherits this via the global config.
configure({
  defaults: {
    maxCostPerRun: 5.00,
  },
})

// --- Researcher agent tools ---

async function webSearch(query: string): Promise<{ results: string[]; usage: { prompt_tokens: number; completion_tokens: number }; model: string }> {
  // Real operation: search source files for the query term
  const srcDir = join(import.meta.dirname, '..', '..', '..', 'packages', 'core', 'src')
  const files = readdirSync(srcDir).filter(f => f.endsWith('.ts'))
  const results: string[] = []
  for (const file of files) {
    const content = readFileSync(join(srcDir, file), 'utf-8')
    if (content.toLowerCase().includes(query.toLowerCase())) {
      const lines = content.split('\n').length
      results.push(`[${file}] ${lines} lines -- contains "${query}"`)
    }
  }
  return {
    results: results.slice(0, 5),
    usage: { prompt_tokens: 2000, completion_tokens: 500 },
    model: 'gpt-4o',
  }
}

async function summarise(documents: string[]): Promise<{ result: string; usage: { prompt_tokens: number; completion_tokens: number }; model: string }> {
  // Real operation: compute aggregate stats
  const totalMentions = documents.length
  const fileNames = documents.map(d => d.match(/\[(.+?)\]/)?.[1] ?? 'unknown')
  return {
    result: `Found "${totalMentions}" matching files: ${fileNames.join(', ')}`,
    usage: { prompt_tokens: 3000, completion_tokens: 800 },
    model: 'gpt-4o',
  }
}

// --- Writer agent tools ---

async function draft(summary: string, tone: string): Promise<{ result: string; usage: { prompt_tokens: number; completion_tokens: number }; model: string }> {
  const hash = createHash('md5').update(summary).digest('hex').slice(0, 8)
  return {
    result: `[Draft-${hash} | tone=${tone}]\n${summary}\n\nThis analysis covers the key patterns found across the codebase.`,
    usage: { prompt_tokens: 4000, completion_tokens: 2000 },
    model: 'gpt-4o',
  }
}

async function editDraft(text: string): Promise<{ result: string; usage: { prompt_tokens: number; completion_tokens: number }; model: string }> {
  return {
    result: text
      .replace('covers', 'examines')
      .replace('patterns', 'architectural decisions'),
    usage: { prompt_tokens: 2000, completion_tokens: 1500 },
    model: 'gpt-4o',
  }
}

// --- Multi-agent workflow ---

async function main() {
  console.log('Fuze AI -- Multi-Agent Shared Budget\n')

  const run = createRun('research-team')
  console.log(`Run ID : ${run.runId}`)
  console.log(`Budget : $5.00 (shared across all agents)\n`)

  // --- Researcher agent ---
  console.log('=== Researcher Agent ===')

  const guardedSearch = run.guard(webSearch, {
    model: 'openai/gpt-4o', // pricing table; cost auto-extracted from response usage
  })
  const guardedSummarise = run.guard(summarise, {
    model: 'openai/gpt-4o', // pricing table; cost auto-extracted from response usage
  })

  const searchResponse = await guardedSearch('budget')
  console.log('Search results:', searchResponse.results)

  const summaryResponse = await guardedSummarise(searchResponse.results)
  console.log('Summary:', summaryResponse.result)

  const midStatus = run.getStatus()
  console.log(`  [budget after researcher: $${midStatus.totalCost.toFixed(4)} spent, ${midStatus.stepCount} steps]\n`)

  // --- Writer agent ---
  console.log('=== Writer Agent ===')

  const guardedDraft = run.guard(draft, {
    model: 'openai/gpt-4o', // pricing table; cost auto-extracted from response usage
  })
  const guardedEdit = run.guard(editDraft, {
    model: 'openai/gpt-4o', // pricing table; cost auto-extracted from response usage
  })

  const draftResponse = await guardedDraft(summaryResponse.result, 'technical')
  console.log('Draft:', draftResponse.result)

  const editResponse = await guardedEdit(draftResponse.result)
  console.log('Edited:', editResponse.result)
  console.log()

  // --- Final run status ---
  console.log('=== Run Status ===')
  const status = run.getStatus()
  console.log(`  Total cost     : $${status.totalCost.toFixed(4)}`)
  console.log(`  Total tokens in: ${status.totalTokensIn}`)
  console.log(`  Total tokens out: ${status.totalTokensOut}`)
  console.log(`  Steps completed: ${status.stepCount}`)
  console.log(`  Remaining budget: $${(5.00 - status.totalCost).toFixed(4)}`)
  console.log()

  await run.end()
  console.log('Run ended. Check ./fuze-traces.jsonl for the full trace.')
}

main().catch(console.error)
