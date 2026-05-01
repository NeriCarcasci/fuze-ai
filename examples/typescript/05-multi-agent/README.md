# Example 05 — Multi-Agent Shared Run

Two agents (researcher + writer) share one `createRun()` context. All tool calls from both agents share its loop detector and token ceiling.

## How it works

```ts
const run = createRun('research-team')

// Each tool is wrapped via run.guard(), so they all report into the same run.
const search = run.guard(webSearch)
const summary = run.guard(summarise)
const drafter = run.guard(draft)
const editor = run.guard(editDraft)

// run.getStatus() — { totalTokensIn, totalTokensOut, stepCount }
// run.end()       — flushes the trace and marks the run completed
```

The session-wide `maxTokensPerRun` is enforced across every call from every wrapped tool.

## Run

```bash
npm install
npm start
```

## What to look for in the trace

- All four steps share the same `runId`.
- `tokensIn` / `tokensOut` accumulate across all four calls.
- A single `run_start` and `run_end` record bracket the steps.
