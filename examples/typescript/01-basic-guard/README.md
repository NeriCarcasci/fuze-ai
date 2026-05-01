# Example 01 — Basic Guard

Wrap one async tool with `guard()` and call it like the original. Every call is traced; tokens are auto-extracted from the OpenAI-shaped `usage` payload.

## Run

```bash
npm install
npm start
```

## What to look for in the trace

Open `./fuze-traces.jsonl` after the run. Each line is one record:

- `toolName` — the wrapped function (`classify`)
- `argsHash` — a hash of the arguments; differs per call
- `tokensIn` / `tokensOut` — extracted automatically from the returned `usage` field
- `latencyMs` — wall-clock time per call
