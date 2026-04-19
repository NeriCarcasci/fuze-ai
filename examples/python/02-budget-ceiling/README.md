# Example 02 -- Token Ceiling

Shows how Fuze AI enforces per-run token limits.

## What it demonstrates

- `configure()` to set a session-wide `max_tokens_per_run` of 100,000
- `@guard()` wrapping an async call whose response carries OpenAI-shaped usage data
- Catching `ResourceLimitExceeded` when cumulative tokens cross the ceiling
- Each call consumes ~58,000 tokens, so the second call pushes the run past the 100,000-token ceiling and is blocked

## How to run

```bash
pip install fuze-ai
python main.py
```

## Expected output

```
Fuze AI -- Token Ceiling Example

Run ceiling : 100,000 tokens (input + output combined)
Per call    : ~58,000 tokens (auto-extracted from response.usage)

Call 1 OK      : Chunk "quarterly-report" analysed: sha256=...
Call 2 BLOCKED : ResourceLimitExceeded: step 'analyse_chunk' exceeded maxTokensPerRun (observed 116000, ceiling 100000)
  limit    : maxTokensPerRun
  observed : 116000
  ceiling  : 100000

Resource-limit enforcement prevented runaway token usage.

Done. Check ./fuze-traces.jsonl for per-step token usage.
```

## Key takeaway

Token enforcement is immediate -- Fuze checks the cumulative token total after each
step and blocks the next step if the ceiling would be crossed, rather than allowing
the overage and reporting it after the fact.
