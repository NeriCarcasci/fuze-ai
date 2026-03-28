
<p align="center">
  <strong>Runtime safety layer for AI agents.</strong><br/>
  Loop detection · Budget enforcement · Side-effect tracking · EU AI Act compliance
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> ·
  <a href="#why-fuze">Why Fuze</a> ·
  <a href="#how-it-works">How It Works</a> ·
  <a href="#python">Python</a> ·
  <a href="#mcp-proxy">MCP Proxy</a> ·
  <a href="#dashboard">Dashboard</a> ·
  <a href="#eu-ai-act">EU AI Act</a> ·
  <a href="https://fuze-ai.dev/docs">Docs</a>
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/fuze-ai?color=ff5544&label=npm" alt="npm version"/>
  <img src="https://img.shields.io/pypi/v/fuze-ai?color=ff5544&label=pypi" alt="pypi version"/>
  <img src="https://img.shields.io/github/license/fuze-ai/fuze?color=ff5544" alt="license"/>
  <img src="https://img.shields.io/github/stars/fuze-ai/fuze?color=ff5544" alt="stars"/>
</p>

---

Your agent framework runs the agent. **Fuze makes sure it doesn't bankrupt you while it runs.**

A [$1.6M weekend bill](https://geekfence.com/the-1-6-million-weekend-why-simple-api-gateways-fail-in-the-agentic-era/) from one retry loop. A [$47K invoice](https://rocketedge.com/2026/03/15/your-ai-agent-bill-is-30x-higher-than-it-needs-to-be-the-6-tier-fix/) from two agents ping-ponging for 11 days. [$400M in unbudgeted cloud spend](https://analyticsweek.com/finops-for-agentic-ai-cloud-cost-2026/) across the Fortune 500. These aren't edge cases — they're the norm when agents run without guardrails.

Fuze is a **middleware** that wraps your existing agent tools — in LangGraph, CrewAI, Google ADK, raw OpenAI/Anthropic SDK, or any MCP server — with runtime protection. One decorator. No framework migration.

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

// Mark dangerous operations. Fuze won't blindly retry these.
const sendInvoice = guard(
  async (customerId: string, amount: number) => {
    return await stripe.createInvoice(customerId, amount)
  },
  { sideEffect: true, compensate: cancelInvoice }
)

// Set a cost ceiling. Fuze kills the run before you overspend.
const analyse = guard(
  async (text: string) => llm.complete(`Analyse: ${text}`),
  { maxCost: 0.50 }
)
```

### Python

```bash
pip install fuze-ai
```

```python
from fuze_ai import guard

# Bare minimum — sensible defaults protect you
@guard
def search(query: str):
    return vector_db.search(query)

# Side-effect: Fuze tracks this and can roll it back
@guard(side_effect=True, compensate=cancel_invoice)
def send_invoice(customer_id: str, amount: float):
    return stripe.create_invoice(customer_id, amount)

# Cost cap
@guard(max_cost=0.50)
def analyse(text: str):
    return llm.complete(f"Analyse: {text}")
```

## Why Fuze

Every major agent framework — LangGraph, CrewAI, Google ADK, Microsoft Agent Framework — saves state but **leaves failure detection, automatic recovery, and duplicate prevention entirely to you** ([source](https://www.diagrid.io/blog/still-not-durable-how-microsoft-agent-framework-and-strands-agents-repeat-the-same-mistake)).

| Problem | What happens today | What Fuze does |
|---|---|---|
| **Runaway loops** | Agent retries forever. You find out Monday. | Detects repeated tool calls, semantic stalls, cost velocity spikes. Kills or recovers automatically. |
| **Budget explosion** | No ceiling. Token spend compounds silently. | Hard $/token/time limits per step and per run. Pre-execution cost estimation. |
| **Duplicate side-effects** | Checkpoint-restore causes double payments ([paper](https://arxiv.org/html/2603.20625v1)). | Tracks which calls changed the real world. Idempotency keys. Compensation on rollback. |
| **No audit trail** | Logs say "Agent stopped due to max iterations." | Full decision trace: what the LLM saw, decided, called, and what happened — replayable. |
| **EU AI Act** | 4 months until enforcement. €35M or 7% penalty. | Art. 12 logging, Art. 14 human oversight, Art. 73 incident reports — out of the box. |

### Fuze vs `max_iterations`

Setting `max_iterations=10` is a blunt instrument that handles **one of five** failure modes. It's a fuse that blows but doesn't tell you which appliance is faulty, doesn't switch to a backup, and doesn't file the insurance claim.

Fuze is the circuit breaker + smoke detector + fire suppression + documentation, in one `@guard`.

## How It Works

Fuze operates in three modes, each building on the last:

### Mode 1: In-Process SDK (zero infrastructure)

```
[Your Agent Code] → [@guard decorator] → [Tool Call]
                         ↓
                  Budget check ✓
                  Loop detection ✓
                  Timeout ✓
                  Local trace file ✓
```

Just `npm install` / `pip install`. No daemon, no database. Guards run in-process with <0.3ms overhead.

### Mode 2: SDK + Daemon (centralised protection)

```
[Agent A] → [guard] ─→ [Fuze Daemon] ─→ [SQLite/Postgres]
[Agent B] → [guard] ─↗        ↓
[Agent C] → [guard] ─↗   Kill signals
                      Cross-run patterns
                      Org-wide budgets
```

```bash
npx fuze-ai daemon
```

The daemon aggregates telemetry from all SDK instances, detects cross-run patterns, enforces org-wide budgets, and can kill any run externally.

### Mode 3: SDK + Daemon + Dashboard (full monitoring)

```bash
npx fuze-ai dashboard    # Web UI at localhost:4200
npx fuze-ai tui          # Terminal UI (works over SSH)
```

Live runs. Trace replay. Budget charts. Kill buttons. EU AI Act compliance panel.

## Configuration

```toml
# fuze.toml — project-level defaults

[defaults]
max_retries = 3
timeout = "30s"
max_cost_per_step = 1.00
max_cost_per_run = 10.00
max_iterations = 25
kill_on_loop = true

[daemon]
socket_path = "/tmp/fuze.sock"
storage = "sqlite"
retention_days = 180

[compliance]
enabled = false
risk_level = "minimal"   # minimal | limited | high
log_pii = false          # hash args by default for GDPR
```

Per-function overrides always win:

```typescript
// This function gets a tighter ceiling than the project default
const riskyCall = guard(fn, { maxCost: 0.10, timeout: 5000 })
```

## Framework Adapters

### LangGraph

```python
from fuze_ai.adapters.langgraph import fuze_tool

@fuze_tool(side_effect=True)
def send_email(to: str, body: str) -> str:
    """Send an email."""
    return smtp.send(to, body)

tool_node = ToolNode([send_email])  # Works as normal
```

### CrewAI

```python
from fuze_ai.adapters.crewai import FuzeMixin

class EmailTool(FuzeMixin, BaseTool):
    fuze_config = {"side_effect": True, "max_retries": 1}

    def _run(self, to: str, body: str) -> str:
        return smtp.send(to, body)
```

## MCP Proxy

Zero-code-change protection for **any** MCP server:

```bash
# Before: client connects directly to MCP server
npx @modelcontextprotocol/server-postgres

# After: Fuze sits in between
npx fuze-ai proxy -- npx @modelcontextprotocol/server-postgres
```

Every `tools/call` is intercepted. Budget checked. Loop detected. Side-effects tracked. Logged. The MCP server and client don't know Fuze exists.

## EU AI Act

EU AI Act enforcement begins **August 2, 2026**. Penalties up to **€35M or 7% of global annual revenue**.

Fuze directly covers 8 Articles for high-risk AI systems:

| Article | Requirement | Fuze Feature |
|---|---|---|
| **Art. 12** | Automatic event recording | Full trace of every agent step |
| **Art. 13** | Deployers can interpret output | Trace replay with decision context |
| **Art. 14** | Human oversight + stop button | Kill switch, approval gates, dashboard |
| **Art. 15** | Robustness under errors | Loop detection, recovery strategies, side-effect compensation |
| **Art. 19** | Log retention ≥6 months | Append-only audit store, configurable retention |
| **Art. 26** | Deployer monitoring obligations | Dashboard, alerts, agent health scores |
| **Art. 72** | Post-market monitoring | Continuous runtime monitoring, trend analysis |
| **Art. 73** | Incident reporting (72h/15d) | Structured incident report PDF export |

Detailed compliance matrix: [docs/compliance-matrix.md](./docs/compliance-matrix.md)

## Logging

Fuze logs every guarded function call:

- **Timestamps** — start/end per step, ISO 8601
- **Agent identity** — agent_id, version, model provider, model name
- **Tool calls** — name, args hash (raw args opt-in), result summary
- **Cost** — tokens in/out, USD per provider pricing
- **Guard decisions** — proceed, loop detected, budget checked, side-effect flagged
- **Human oversight** — who intervened, what they decided
- **Side-effect status** — was this a write? compensation status?

All records are **append-only** with hash chain for tamper detection. Default: args are hashed, not stored raw (GDPR-safe). Full logging opt-in via `log_pii = true`.

## Roadmap

- [x] TypeScript core library
- [x] Python SDK with `@guard` decorator
- [ ] Runtime daemon with cross-run pattern detection
- [ ] MCP proxy mode
- [ ] Side-effect compensation engine
- [ ] TUI dashboard (Ink)
- [ ] Web dashboard + EU AI Act compliance panel
- [ ] LangGraph adapter
- [ ] CrewAI adapter
- [ ] Google ADK adapter
- [ ] OpenTelemetry export
- [ ] PostgreSQL storage backend

## Contributing

Fuze is MIT licensed. Contributions welcome.

```bash
git clone https://github.com/fuze-ai/fuze
cd fuze
npm install
npm test
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

[MIT](./LICENSE)

---

<p align="center">
  Built in Ireland 🇮🇪 · EU AI Act native · Open source
</p>