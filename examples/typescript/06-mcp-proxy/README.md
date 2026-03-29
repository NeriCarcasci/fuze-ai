# 06 - MCP Proxy

Fuze AI can sit between an MCP client and an MCP server as a transparent proxy,
enforcing budget ceilings, loop detection, and side-effect policies on every
tool call -- without changing a single line of your agent code.

## Installation

```bash
npm install -g fuze-ai    # or use npx
```

## Configuration

Create a `fuze.toml` in your project root (see the included example file):

```toml
[proxy]
maxCostPerRun  = 10.00       # USD budget ceiling for the entire session
maxIterations  = 50           # hard cap on total tool calls
traceOutput    = "./traces/mcp-proxy.jsonl"
onLoop         = "kill"       # "kill" | "warn" | "skip"

# Per-tool overrides — the key is the MCP tool name
[proxy.tools.web_search]
maxCost       = 0.50          # per-call ceiling
sideEffect    = false

[proxy.tools.send_email]
sideEffect    = true          # marks this tool as having real-world consequences
maxCost       = 0.10

[proxy.tools.create_invoice]
sideEffect    = true
maxCost       = 1.00
```

## Running the proxy

The proxy wraps any MCP-compatible server command:

```bash
npx fuze-ai proxy -- <server-command> [args...]
```

### Examples

```bash
# Wrap an MCP server that speaks over stdio
npx fuze-ai proxy -- node my-mcp-server.js

# Wrap a Python MCP server
npx fuze-ai proxy -- python -m my_mcp_server --port 3001

# Pass additional CLI options
npx fuze-ai proxy --max-cost 5.00 --max-iterations 30 -- node server.js
```

## CLI options

| Flag               | Description                                         | Default               |
|--------------------|-----------------------------------------------------|-----------------------|
| `--max-cost`       | Override `maxCostPerRun` from `fuze.toml`            | from config or `Inf`  |
| `--max-iterations` | Override `maxIterations` from `fuze.toml`            | from config or `25`   |
| `--trace`          | Path to the trace output file                        | `./fuze-traces.jsonl` |
| `--verbose`        | Print every intercepted tool call to stderr          | `false`               |
| `--daemon`         | Connect to the Fuze daemon for live dashboard updates| `false`               |

## What gets intercepted

The proxy intercepts every MCP `tools/call` request **before** it reaches the
underlying server:

1. **Budget check** -- The estimated cost of the call is compared against the
   per-tool `maxCost` and the session-wide `maxCostPerRun`. If either would be
   exceeded, the call is rejected with a `BudgetExceeded` error returned to
   the client.

2. **Loop detection** -- The proxy tracks call patterns (repeated identical
   calls, no-progress sequences, cost velocity). If a loop is detected, the
   configured `onLoop` action fires (`kill`, `warn`, or `skip`).

3. **Side-effect tagging** -- Tools marked `sideEffect: true` are flagged in
   the trace log. The proxy will not auto-retry these tools on transient
   failure.

4. **Trace recording** -- Every call (allowed or blocked) is appended to the
   trace file as a JSONL record with timing, cost, token counts, and the guard
   decision.

## Where traces go

By default, traces are written to `./fuze-traces.jsonl` (relative to the
working directory). Override with `traceOutput` in `fuze.toml` or `--trace`
on the command line.

Each line is a JSON object:

```jsonc
// Step record
{ "type": "step", "runId": "...", "toolName": "web_search", "costUsd": 0.003, ... }

// Guard event (loop detected, budget exceeded)
{ "type": "guard_event", "runId": "...", "type": "loop_detected", "severity": "critical", ... }

// Run lifecycle
{ "type": "run_start", "runId": "...", "agentId": "mcp-proxy", ... }
{ "type": "run_end",   "runId": "...", "status": "completed", "totalCost": 0.42, ... }
```

When `--daemon` is active, the same events are also pushed to the Fuze daemon
over a Unix socket (or named pipe on Windows), enabling real-time monitoring
via the dashboard.
