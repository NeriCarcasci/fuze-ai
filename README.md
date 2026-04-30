
<p align="center">
  <strong>Runtime safety layer for AI agents.</strong><br/>
  Loop detection, resource limits, side-effect tracking, and EU AI Act compliance
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#why-fuze">Why Fuze</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#token-extraction">Token Extraction</a> ·
  <a href="#python">Python</a> ·
  <a href="#mcp-proxy">MCP Proxy</a> ·
  <a href="#dashboard">Dashboard</a> ·
  <a href="#eu-ai-act">EU AI Act</a> ·
  <a href="https://fuze-ai.dev/docs">Docs</a>
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/fuze-ai?color=ff5544&label=npm" alt="npm version"/>
  <img src="https://img.shields.io/pypi/v/fuze-ai?color=ff5544&label=pypi" alt="pypi version"/>
  <img src="https://img.shields.io/github/license/nericarcasci/fuze-ai?color=ff5544" alt="license"/>
  <img src="https://img.shields.io/github/stars/nericarcasci/fuze-ai?color=ff5544" alt="stars"/>
</p>


Your agent framework runs the agent. **Fuze makes sure it doesn't run away while it runs.**


One retry loop can burn through a quarter's token budget over a weekend. Two agents ping-ponging for days can drain an API quota before anyone notices. Across the Fortune 500, unbudgeted agent token spend is measured in the hundreds of millions. These aren't edge cases; they're the norm when agents run without guardrails — and dollars only surface the damage *after* the tokens are gone. Fuze caps the tokens.

Fuze is a **middleware** that wraps your existing agent tools (in LangGraph, CrewAI, Google ADK, raw OpenAI/Anthropic SDK, or any MCP server) with runtime protection. One decorator. No framework migration.

## Quickstart

### TypeScript

```bash
npm install fuze-ai
```

```typescript
import { guard } from 'fuze-ai'

// That's it. Default protection: timeout, retry limits, loop detection.
const search = guard(async (query: string) => {
  return await vectorDb.search(query)
})

// Pass model — Fuze reads actual token counts from the LLM response automatically.
// No manual estimatedTokensIn/Out needed.
const analyse = guard(
  async (text: string) => openai.chat.completions.create({ model: 'gpt-4o', messages: [...] }),
  { model: 'openai/gpt-4o', maxTokens: 50000 }
)

// Mark dangerous operations. Fuze won't blindly retry these.
const sendInvoice = guard(
  async (customerId: string, amount: number) => {
    return await stripe.createInvoice(customerId, amount)
  },
  { sideEffect: true, compensate: cancelInvoice }
)
```

### Python

```bash
pip install fuze-ai
```

```python
from fuze_ai import guard

# Bare minimum: sensible defaults protect you
@guard
def search(query: str):
    return vector_db.search(query)

# Pass model — Fuze reads actual tokens from the response automatically.
@guard(model='openai/gpt-4o', max_tokens=50000)
def analyse(text: str):
    return openai.chat.completions.create(model='gpt-4o', messages=[...])

# Side-effect: Fuze tracks this and can roll it back.
@guard(side_effect=True, compensate=cancel_invoice)
def send_invoice(customer_id: str, amount: float):
    return stripe.create_invoice(customer_id, amount)
```

## Why Fuze

Every major agent framework (LangGraph, CrewAI, Google ADK, Microsoft Agent Framework) saves state but **leaves failure detection, automatic recovery, and duplicate prevention entirely to you** ([source](https://www.diagrid.io/blog/still-not-durable-how-microsoft-agent-framework-and-strands-agents-repeat-the-same-mistake)).

| Problem | What happens today | What Fuze does |
|---|---|---|
| **Runaway loops** | Agent retries forever. You find out Monday. | Detects repeated tool calls, semantic stalls, stalled progress. Kills or recovers automatically. |
| **Resource explosion** | No ceiling. Token spend compounds silently. | Hard token/step/wall-clock limits per step and per run. Automatic token extraction from every LLM response. |
| **Duplicate side-effects** | Checkpoint-restore causes double payments ([paper](https://arxiv.org/html/2603.20625v1)). | Tracks which calls changed the real world. Idempotency keys. Compensation on rollback. |
| **No audit trail** | Logs say "Agent stopped due to max iterations." | Full decision trace: what the LLM saw, decided, called, and what happened (replayable). |
| **EU AI Act** | Enforcement begins August 2026. €35M or 7% penalty. | Art. 12 logging, Art. 14 kill-switch (approval gates on roadmap), Art. 15 robustness. See coverage details below. |

### Fuze vs `max_iterations`

Setting `max_iterations=10` is a blunt instrument that handles **one of five** failure modes. It's a fuse that blows, but doesn't tell you which appliance is faulty, doesn't switch to a backup, and doesn't file the insurance claim.

Fuze is the circuit breaker, smoke detector, fire suppression, and documentation, all in one `@guard`.

## How It Works

Fuze operates in three modes, each building on the last:

### Mode 1: In-Process SDK (zero infrastructure)

```
[Your Agent Code] → [@guard decorator] → [Tool Call]
                         ↓
                  Token/step cap ✓
                  Loop detection ✓
                  Timeout ✓
                  Local trace file ✓
```

Just `npm install` or `pip install`. No daemon, no database. Guards run in-process with less than 0.3ms overhead.

### Mode 2: SDK + Daemon (centralised protection)

```
[Agent A] → [guard] ─→ [Fuze Daemon] ─→ [SQLite/Postgres]
[Agent B] → [guard] ─↗        ↓
[Agent C] → [guard] ─↗   Kill signals
                      Cross-run patterns
```

```bash
npx fuze-ai daemon
```

The daemon aggregates telemetry from all SDK instances and detects cross-run patterns. Note: cross-run token/step enforcement (org-wide caps) is on the roadmap and not yet implemented.

### Mode 3: SDK + Daemon + Dashboard (full monitoring)

```bash
npx fuze-ai dashboard    # Web UI at localhost:4200
npx fuze-ai tui          # Terminal UI (works over SSH)
```

Live runs, trace replay, token/step usage charts, kill buttons, and an EU AI Act compliance panel.

## Token Extraction

When you pass `model` to `guard()`, Fuze automatically reads the actual token counts from the LLM's response object — no manual `estimatedTokensIn`/`estimatedTokensOut` needed.

```typescript
import { guard, createRun } from 'fuze-ai'

// Fuze inspects the return value and finds the usage fields automatically.
const callLLM = guard(
  async (prompt: string) => openai.chat.completions.create({ model: 'gpt-4o', messages: [{ role: 'user', content: prompt }] }),
  { model: 'openai/gpt-4o' }
)

// All tools in the same run share one resource limit + loop detector.
const run = createRun('my-agent', { maxTokensPerRun: 200000, maxStepsPerRun: 50 })
const search = run.guard(searchFn, { model: 'openai/gpt-4o' })
const summarise = run.guard(summariseFn, { model: 'anthropic/claude-opus-4-6' })
```

Fuze recognises response shapes from all major providers out of the box:

| Provider | Response shape detected |
|---|---|
| OpenAI, OpenRouter, Azure, Together, Fireworks, Mistral | `usage.prompt_tokens` / `usage.completion_tokens` |
| Anthropic | `usage.input_tokens` / `usage.output_tokens` |
| Google Gemini | `usageMetadata.promptTokenCount` / `candidatesTokenCount` |
| Vercel AI SDK, Mastra | `usage.promptTokens` / `usage.completionTokens` |
| LangChain AIMessage | `usage_metadata.input_tokens` / `output_tokens` |
| LangChain legacy ChatResult | `llm_output.token_usage.prompt_tokens` |
| AWS Bedrock | `usage.inputTokens` / `usage.outputTokens` |
| Cohere | `meta.tokens.input_tokens` / `output_tokens` |

For custom providers or non-standard shapes, use `usageExtractor`:

```typescript
const fn = guard(
  async () => myCustomLLM.call(),
  {
    model: 'my-provider/model',
    usageExtractor: (result) => ({
      tokensIn: result.metadata.input,
      tokensOut: result.metadata.output,
    }),
  }
)
```

### Pre-flight token estimate

Before the call, Fuze estimates token usage from the serialised argument size (4 chars ≈ 1 token, 50% output ratio). This catches obviously over-limit calls before making the API request. After the call, the estimate is replaced with the actual extracted count.

```typescript
// This is blocked before the API call is even made — 10M token args exceed any sensible limit
const fn = guard(hugeArgs, { model: 'openai/gpt-4o', maxTokens: 50000 })
await fn('x'.repeat(40_000_000)) // → throws LimitExceeded immediately
```

## Configuration

```toml
# fuze.toml: project-level defaults

[defaults]
max_retries = 3
timeout = "30s"
max_tokens_per_step = 50000
max_tokens_per_run = 500000
max_steps_per_run = 50
max_iterations = 25
kill_on_loop = true

[loop_detection]
window_size = 20
repeat_threshold = 3
max_flat_steps = 5

[daemon]
socket_path = "/tmp/fuze.sock"
storage = "sqlite"
retention_days = 180

[compliance]
enabled = false
risk_level = "minimal"   # minimal | limited | high
log_pii = false          # args are not stored raw by default; set true to opt in
```

Per-function overrides always take precedence:

```typescript
// This function gets a tighter ceiling than the project default
const riskyCall = guard(fn, { maxTokens: 5000, timeout: 5000 })
```

## Framework Adapters

Framework adapters are available in the Python SDK only. The TypeScript SDK does not yet ship framework adapters; integration is via the core `guard()` function directly.

### LangGraph (Python)

```python
from fuze_ai.adapters.langgraph import fuze_tool

@fuze_tool(side_effect=True)
def send_email(to: str, body: str) -> str:
    return smtp.send(to, body)

tool_node = ToolNode([send_email])  # Works as normal
```

### CrewAI (Python)

```python
from fuze_ai.adapters.crewai import FuzeMixin

class EmailTool(FuzeMixin, BaseTool):
    fuze_config = {"side_effect": True, "max_retries": 1}

    def _run(self, to: str, body: str) -> str:
        return smtp.send(to, body)
```

## MCP Proxy

Zero-code-change protection for any MCP server:

```bash
# Before: client connects directly to MCP server
npx @modelcontextprotocol/server-postgres

# After: Fuze sits in between
npx fuze-ai proxy -- npx @modelcontextprotocol/server-postgres
```

Every `tools/call` is intercepted: resource caps checked, loop detected, side-effects tracked, and logged. The MCP server and client don't know Fuze exists.

Token usage is extracted automatically from MCP tool responses when they contain recognisable LLM response shapes.

## EU AI Act

EU AI Act enforcement begins **August 2, 2026**. Penalties up to **€35M or 7% of global annual revenue**.

Fuze addresses several Articles for high-risk AI systems. The table below reflects what is implemented today. See the detailed compliance matrix for per-article status.

| Article | Requirement | Status | Notes |
|---|---|---|---|
| **Art. 12** | Automatic event recording | Covered | Full JSONL trace of every agent step; hash chain for tamper detection (Python only today) |
| **Art. 13** | Deployers can interpret output | Partial | Trace replay with decision context; model cards not auto-generated |
| **Art. 14** | Human oversight and stop button | Partial | Kill switch via dashboard and CLI; approval gates not yet implemented |
| **Art. 15** | Robustness under errors | Covered | Loop detection (iteration cap, hash dedup, stalled progress), side-effect compensation, token/step/wall-clock limits |
| **Art. 19** | Log retention (≥6 months) | Covered (Python) / Partial (TS) | Append-only store, configurable retention; hash chain is Python only |
| **Art. 26** | Deployer monitoring obligations | Covered | Dashboard monitoring surface plus admin audit log of privileged actions (role changes, billing, retention, OTEL configuration) |
| **Art. 72** | Post-market monitoring | Partial | Runtime metrics collected; automated drift detection not implemented |
| **Art. 73** | Incident reporting (72h/15d) | Not implemented | Roadmap item — no auto-filing today |

Detailed compliance matrix: [docs/compliance-matrix.md](./docs/compliance-matrix.md)

## Logging

Fuze logs every guarded function call:

- **Timestamps**: start/end per step, ISO 8601
- **Agent identity**: agent_id, version, model provider, model name
- **Tool calls**: name, args hash (raw args opt-in via `log_pii = true`), result summary
- **Tokens**: tokens in/out extracted automatically from LLM responses
- **Guard decisions**: proceed, loop detected, limit exceeded, side-effect flagged
- **Human oversight**: who intervened, what they decided
- **Side-effect status**: was this a write? compensation status?

All records are **append-only**. The Python SDK adds a HMAC-SHA256 hash chain for tamper detection; TypeScript hash chain parity is on the roadmap. By default, raw arguments are not stored — set `log_pii = true` to opt in. Note: hashing arguments is not a substitute for GDPR-compliant data minimisation; review your data retention obligations independently.

## Roadmap

- [x] TypeScript core library
- [x] Python SDK with `@guard` decorator
- [x] Automatic token extraction from LLM response objects (8 provider shapes)
- [x] MCP proxy mode
- [x] Side-effect compensation engine (LIFO, idempotent)
- [x] Web dashboard: runs list, trace replay, agent health, compliance panel, retention settings, API keys, team management (5-role RBAC), billing, OTEL forwarding to customer backends, admin audit log, vendor VRA auto-responder, self-serve data export and erasure
- [x] LangGraph adapter (Python)
- [x] CrewAI adapter (Python)
- [x] Annex IV PDF export
- [x] HMAC hash chain for trace tamper detection (Python)
- [ ] Hash chain parity (TypeScript)
- [ ] OpenTelemetry export
- [ ] PostgreSQL storage backend
- [ ] Art. 14 approval gates
- [ ] Art. 73 incident auto-filing
- [ ] Daemon / cross-run token and step enforcement
- [ ] Framework adapters for TypeScript

## What Fuze does not do today

This section exists so you can make an informed procurement decision. The following are on the roadmap but not yet shipped:

- **Art. 73 incident auto-filing** — no automated 72h/15d report submission; manual process required
- **Art. 14 approval gates** — kill switch is implemented; workflow-level approval before an agent proceeds is not
- **Art. 50 GPAI transparency** — disclosure system for general-purpose AI outputs is not implemented
- **TypeScript hash chain** — HMAC-SHA256 trace tamper detection is Python only; TS parity is on the roadmap
- **OpenTelemetry exporter** — not yet available in either SDK
- **Daemon / cross-run caps** — the daemon is a stub; org-wide token/step caps are not enforced across runs
- **Self-host / on-prem** — Fuze Cloud is the only deployment option today
- **SSO / SAML** — not implemented; on the roadmap for Scale tier
- **Certifications** — SOC 2 Type II and ISO 27001 audits are in progress (targets: 2026 Q4 and 2027 Q1 respectively); HDS has no confirmed date

## Contributing

Fuze is MIT licensed. Contributions welcome.

```bash
git clone https://github.com/NeriCarcasci/fuze-ai
cd fuze-ai
npm install
npm test                           # JS tests across all packages
cd packages/python && pip install -e ".[dev]" && pytest
```

This is a monorepo: `packages/core` (JS SDK), `packages/daemon` (self-hosted runtime), `packages/python` (Python SDK). Agent context lives in [AGENTS.md](./AGENTS.md) and [.context/](./.context/) — read those before opening a PR.

## License

[MIT](./LICENSE)

---

<p align="center">
  Built in Ireland 🇮🇪, EU AI Act native, open source
</p>
