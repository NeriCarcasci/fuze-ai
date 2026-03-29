# 05 - Multi-Agent Shared Budget

Demonstrates two agents (researcher + writer) sharing a single budget via
`createRun()`. All tool calls from both agents are tracked under one run
context with unified cost accounting.

## What this example shows

1. **Shared run context** -- `createRun('research-team', { maxCostPerRun: 5.00 })`
   creates a run that both agents share. Every call to `run.guard(fn)` draws
   from the same $5.00 budget.

2. **Researcher agent** calls `webSearch` and `summarise`, each wrapped with
   `run.guard()` and tagged with model/token estimates for cost tracking.

3. **Writer agent** calls `draft` and `editDraft` using the same run. If the
   researcher already spent most of the budget, the writer's calls may trigger
   `BudgetExceeded`.

4. **`run.getStatus()`** returns the aggregated cost, token counts, and step
   count across both agents.

5. **`run.end()`** flushes the trace log and marks the run as completed.

## Key API

```ts
import { createRun } from 'fuze-ai'

const run = createRun('research-team', { maxCostPerRun: 5.00 })

const search = run.guard(webSearch, {
  model: 'openai/gpt-4o',
  estimatedTokensIn: 500,
  estimatedTokensOut: 200,
})

await search('query')

console.log(run.getStatus())
// { totalCost: 0.0033, totalTokensIn: 500, totalTokensOut: 200, stepCount: 1 }

await run.end()
```

## Run it

```bash
npm install
npm start
```

## Expected output

```
Fuze AI -- Multi-Agent Shared Budget

Run ID: <uuid>

=== Researcher Agent ===
Search results: [ '[1] "AI agent safety frameworks" -- Wikipedia overview', ... ]
Summary: Summary of 3 sources: ...

=== Writer Agent ===
Draft: [Draft -- professional] ...
Edited: [Draft -- professional] ...

=== Run Status ===
  Total cost:      $0.0xxx
  Total tokens in: 5000
  Total tokens out:3000
  Steps completed: 4

Run ended. Check ./fuze-traces.jsonl for the full trace.
```
