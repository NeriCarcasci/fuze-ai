# 05 - Multi-Agent Shared Token Ceiling

Demonstrates two agents (researcher + writer) sharing a single token ceiling
via `createRun()`. All tool calls from both agents are tracked under one run
context with unified token accounting.

## What this example shows

1. **Shared run context** -- `createRun('research-team')` creates a run that
   both agents share. The session-wide `resourceLimits.maxTokensPerRun` ceiling
   is applied across every call from every agent in that run.

2. **Researcher agent** calls `webSearch` and `summarise`, each wrapped with
   `run.guard()`. Fuze auto-extracts `tokensIn`/`tokensOut` from the
   OpenAI-shaped `usage` object returned by each call.

3. **Writer agent** calls `draft` and `editDraft` using the same run. If the
   researcher has already consumed most of the token ceiling, the writer's
   calls may trigger `ResourceLimitExceeded`.

4. **`run.getStatus()`** returns `totalTokensIn`, `totalTokensOut`, and
   `stepCount` across both agents.

5. **`run.end()`** flushes the trace log and marks the run as completed.

## Key API

```ts
import { configure, createRun } from 'fuze-ai'

configure({ resourceLimits: { maxTokensPerRun: 50_000 } })

const run = createRun('research-team')

// tokensIn/tokensOut are auto-extracted from the OpenAI-shaped usage data
// on the return value. No model or pricing configuration needed.
const search = run.guard(webSearch)

await search('query')

console.log(run.getStatus())
// { totalTokensIn: 500, totalTokensOut: 200, stepCount: 1 }

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

Run ID : <uuid>
Ceiling: 50,000 tokens (shared across all agents)

=== Researcher Agent ===
Search results: ['[guard.ts] 362 lines -- contains "budget"', ...]
Summary: Found "N" matching files: ...
  [after researcher: 6300 tokens across 2 steps]

=== Writer Agent ===
Draft: [Draft-<hash> | tone=technical] ...
Edited: [Draft-<hash> | tone=technical] ...

=== Run Status ===
  Tokens in      : 11000
  Tokens out     : 4800
  Steps completed: 4
  Remaining       : 34200 tokens

Run ended. Check ./fuze-traces.jsonl for the full trace.
```
