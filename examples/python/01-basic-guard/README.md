# Example 01 -- Basic Guard

The simplest possible Fuze AI Python example. Decorates a plain async function with `@guard` and calls it three times with different arguments.

## What it demonstrates

- Importing `guard` from `fuze_ai`
- Using the `@guard` decorator so every invocation is automatically traced, budget-checked, and loop-monitored
- Zero-config usage: no `configure()` call needed; Fuze applies sensible defaults (3 retries, 30 s timeout, no cost ceiling)

## How to run

```bash
pip install fuze-ai
python main.py
```

## Expected output

```
Fuze AI -- Basic Guard Example

Search 1: ['Result for "AI agent safety": Document about AI safety', 'Result for "AI agent safety": EU AI Act overview']
Search 2: ['Result for "budget enforcement": Document about AI safety', 'Result for "budget enforcement": EU AI Act overview']
Search 3: ['Result for "loop detection": Document about AI safety', 'Result for "loop detection": EU AI Act overview']

All 3 calls completed.
Check ./fuze-traces.jsonl for the full trace.
```

## What to look for in the trace

After the run, open `./fuze-traces.jsonl`. Each line is a JSON object representing one guarded step. Key fields:

- `tool_name` -- the name of the wrapped function (`search_documents`)
- `args_hash` -- a hash of the arguments passed; differs for each call since the query string changes
- `latency_ms` -- wall-clock time for the call (should be ~200 ms due to the simulated delay)
- `tokens_in` / `tokens_out` -- `0` because the return value did not carry OpenAI-shaped usage data
- `error` -- absent, confirming all three calls succeeded
