# Example 01 — Basic Guard

Decorate one async tool with `@guard` and call it like the original. Every call is traced; tokens are auto-extracted from the OpenAI-shaped `usage` payload.

## Run

```bash
pip install fuze-ai
python main.py
```

## What to look for in the trace

Open `./fuze-traces.jsonl` after the run. Each line is one record:

- `tool_name` — the wrapped function (`classify`)
- `args_hash` — a hash of the arguments; differs per call
- `tokens_in` / `tokens_out` — extracted automatically from the returned `usage` field
- `latency_ms` — wall-clock time per call
