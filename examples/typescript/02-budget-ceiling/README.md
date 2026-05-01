# Example 02 — Budget Ceiling

Configure a per-run token ceiling and watch Fuze block the call that would cross it.

## How it works

`configure()` sets `resourceLimits.maxTokensPerRun: 100_000`. Each call to `analyse` returns an OpenAI-shaped response; Fuze reads `prompt_tokens + completion_tokens` after the call and adds them to the running total. When the total would cross the ceiling, the next guarded step throws `ResourceLimitExceeded` before any further work runs.

Per-call usage is ~58,000 tokens (40K prompt + 18K completion), so the second call pushes the run past the 100,000-token ceiling and is blocked.

## Run

```bash
npm install
npm start
```

## What to look for in the trace

- `tokensIn` / `tokensOut` on each step record show extracted usage.
- The step that triggered the ceiling gets a `guard_event` with `type: "kill"` and the limit details.
- No further steps execute after the ceiling is crossed.
