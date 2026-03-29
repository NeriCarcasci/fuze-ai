import { createRun } from 'fuze-ai'

// --- Simulated AI tool functions ---

async function webSearch(query: string): Promise<string[]> {
  await new Promise(r => setTimeout(r, 200))
  return [
    `[1] "${query}" — Wikipedia overview`,
    `[2] "${query}" — Latest research paper (2025)`,
    `[3] "${query}" — Industry blog post`,
  ]
}

async function summarise(documents: string[]): Promise<string> {
  await new Promise(r => setTimeout(r, 150))
  return `Summary of ${documents.length} sources: The topic is well-covered across academic and industry literature.`
}

async function draft(summary: string, tone: string): Promise<string> {
  await new Promise(r => setTimeout(r, 250))
  return `[Draft — ${tone}]\n${summary}\n\nThis article explores the key findings and their implications for practitioners.`
}

async function editDraft(text: string): Promise<string> {
  await new Promise(r => setTimeout(r, 100))
  return text.replace('explores', 'examines').replace('practitioners', 'the broader community')
}

// --- Multi-agent workflow ---

async function main() {
  console.log('Fuze AI — Multi-Agent Shared Budget\n')

  // Both agents share a single run with a $5.00 budget ceiling.
  const run = createRun('research-team', { maxCostPerRun: 5.00 })
  console.log(`Run ID: ${run.runId}\n`)

  // --- Researcher agent ---
  console.log('=== Researcher Agent ===')

  const guardedSearch = run.guard(webSearch, {
    model: 'openai/gpt-4o',
    estimatedTokensIn: 500,
    estimatedTokensOut: 200,
  })
  const guardedSummarise = run.guard(summarise, {
    model: 'openai/gpt-4o',
    estimatedTokensIn: 2000,
    estimatedTokensOut: 800,
  })

  const sources = await guardedSearch('AI agent safety frameworks')
  console.log('Search results:', sources)

  const summary = await guardedSummarise(sources)
  console.log('Summary:', summary)
  console.log()

  // --- Writer agent ---
  console.log('=== Writer Agent ===')

  const guardedDraft = run.guard(draft, {
    model: 'openai/gpt-4o',
    estimatedTokensIn: 1500,
    estimatedTokensOut: 1000,
  })
  const guardedEdit = run.guard(editDraft, {
    model: 'openai/gpt-4o',
    estimatedTokensIn: 1000,
    estimatedTokensOut: 1000,
  })

  const article = await guardedDraft(summary, 'professional')
  console.log('Draft:', article)

  const finalArticle = await guardedEdit(article)
  console.log('Edited:', finalArticle)
  console.log()

  // --- Run status ---
  console.log('=== Run Status ===')
  const status = run.getStatus()
  console.log(`  Total cost:      $${status.totalCost.toFixed(4)}`)
  console.log(`  Total tokens in: ${status.totalTokensIn}`)
  console.log(`  Total tokens out:${status.totalTokensOut}`)
  console.log(`  Steps completed: ${status.stepCount}`)
  console.log()

  // End the run — flushes traces and marks it complete
  await run.end()
  console.log('Run ended. Check ./fuze-traces.jsonl for the full trace.')
}

main().catch(console.error)
