# fuze-ai (Python)

Runtime safety middleware for AI agents — loop detection, resource limits, side-effect tracking, and audit logging.

See the [main README](https://github.com/fuze-ai/fuze) for full documentation.

## Install

```bash
pip install fuze-ai
```

## Quick Start

```python
from fuze_ai import guard

@guard
def search(query: str) -> list:
    return vector_db.search(query)

# Token limit per call; side-effect with compensation
@guard(max_tokens=50000, side_effect=True, compensate=cancel_invoice)
def send_invoice(customer_id: str, amount: float) -> str:
    return stripe.create_invoice(customer_id, amount)
```

## Resource Limits

Limits are expressed in tokens, steps, and wall-clock time. USD cost is an optional estimate
and is not used as an enforcement boundary.

```python
from fuze_ai import guard, create_run

# Per-call limit
@guard(model='openai/gpt-4o', max_tokens=50000, timeout=30)
def analyse(text: str):
    return openai.chat.completions.create(model='gpt-4o', messages=[...])

# Run-level limits shared across all guarded calls in the run
run = create_run('my-agent', max_tokens_per_run=200000, max_steps_per_run=50)
search = run.guard(search_fn, model='openai/gpt-4o')
summarise = run.guard(summarise_fn, model='anthropic/claude-opus-4-6')
```

## Framework Adapters

The Python SDK ships adapters for LangGraph and CrewAI. The TypeScript SDK does not yet
include framework adapters.

### LangGraph

```python
from fuze_ai.adapters.langgraph import fuze_tool

@fuze_tool(side_effect=True)
def send_email(to: str, body: str) -> str:
    return smtp.send(to, body)

tool_node = ToolNode([send_email])
```

### CrewAI

```python
from fuze_ai.adapters.crewai import FuzeMixin

class EmailTool(FuzeMixin, BaseTool):
    fuze_config = {"side_effect": True, "max_retries": 1}

    def _run(self, to: str, body: str) -> str:
        return smtp.send(to, body)
```

## Logging and Audit

Every guarded call produces a JSONL trace record containing timestamps, agent identity,
token counts, guard decisions, and side-effect status.

The Python SDK includes a HMAC-SHA256 hash chain for tamper detection. Each record carries
`hash`, `prev_hash`, and `signature` fields. TypeScript hash chain parity is on the roadmap.

By default, raw arguments are not stored. Set `log_pii = true` in `fuze.toml` or via the
`FUZE_LOG_PII` environment variable to opt in. Note: this config is declared but not yet
enforced in the current SDK release — enforcement is in progress. Do not rely on it to
suppress argument logging until confirmed in the release notes.

## EU AI Act Coverage (Python SDK)

| Article | Status | Notes |
|---|---|---|
| Art. 12 (logging) | Covered | JSONL trace + HMAC hash chain |
| Art. 14 (human oversight) | Partial | Kill switch only; approval gates not yet shipped |
| Art. 15 (robustness) | Covered | Loop detection, compensation, token/step/wall-clock limits |
| Art. 19 (retention) | Covered | Append-only store, configurable retention |
| Art. 73 (incident reporting) | Not implemented | Roadmap |

## What the Python SDK does not do today

- `log_pii` config enforcement — declared but not yet active (in progress)
- Art. 73 incident auto-filing
- Art. 14 approval gates
- OpenTelemetry exporter
- Daemon / cross-run budget enforcement (stub only)

## License

MIT
