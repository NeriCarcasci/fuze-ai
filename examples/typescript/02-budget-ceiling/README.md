# Example 02 - Token Ceiling

Demonstrates how Fuze AI enforces per-run token ceilings to prevent runaway LLM usage.

## What it demonstrates

- Using `configure()` to set a global run-level token ceiling (`resourceLimits.maxTokensPerRun: 100_000`)
- Auto-extracting `tokensIn`/`tokensOut` from OpenAI-shaped `response.usage`
- Catching `ResourceLimitExceeded` errors and inspecting their `details` (`limit`, `observed`, `ceiling`)

## How it works

Each call to `analyseChunk` returns an OpenAI-shaped response with a `usage` object. Fuze reads `prompt_tokens + completion_tokens` after the call and adds them to the run's running total. When the total crosses `maxTokensPerRun`, the next guarded step throws `ResourceLimitExceeded` before any further work runs.

Per-call usage is ~58,000 tokens (40K prompt + 18K completion), so the second call pushes the run past the 100,000-token ceiling and is blocked.

## How to run

```bash
npm install
npm start
```

## Expected output

```
Fuze AI -- Token Ceiling Example

Run ceiling : 100,000 tokens (input + output combined)
Per call    : ~58,000 tokens (auto-extracted from response.usage)

Step 1 OK     : Chunk "quarterly-report" analysed: sha256=...
Step 2 BLOCKED: ResourceLimitExceeded: step 'analyseChunk' exceeded maxTokensPerRun (observed 116000, ceiling 100000)
  limit    : maxTokensPerRun
  observed : 116000
  ceiling  : 100000
```

## What to look for in the trace

- The `tokensIn` / `tokensOut` fields on each step record show extracted usage.
- The step that triggered the ceiling gets a `guard_event` entry with `type: "kill"` and the limit details.
- No further steps execute after the ceiling is crossed.
