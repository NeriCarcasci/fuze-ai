# Example 05 — Multi-Agent Shared Run

Two agents (researcher + writer) share one `create_run()` context. All tool calls from both agents share its loop detector and token ceiling.

## How it works

```python
run = create_run({"agent_id": "research-team"})

# Each tool is wrapped via run.guard(), so they all report into the same run.
search = run.guard(web_search)
summary = run.guard(summarise)
drafter = run.guard(draft)
editor = run.guard(edit_draft)

# run.get_status() — {'total_tokens_in', 'total_tokens_out', 'step_count', ...}
# run.end()        — flushes the trace and marks the run completed
```

The session-wide `max_tokens_per_run` is enforced across every call from every wrapped tool.

## Run

```bash
pip install fuze-ai
python main.py
```

## What to look for in the trace

- All four steps share the same `run_id`.
- `tokens_in` / `tokens_out` accumulate across all four calls.
- A single `run_start` and `run_end` record bracket the steps.
