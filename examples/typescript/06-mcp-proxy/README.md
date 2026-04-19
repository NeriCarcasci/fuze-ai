# 06 - MCP Proxy

Fuze AI can sit between an MCP client and an MCP server as a transparent proxy,
enforcing token ceilings, loop detection, and side-effect policies on every
tool call -- without changing a single line of your agent code.

## Installation

```bash
npm install -g fuze-ai    # or use npx
```

## Configuration

Create a `fuze.toml` in your project root (see the included example file):

```toml
[proxy]
maxTokensPerRun = 100000      # hard token ceiling for the session
maxIterations   = 50          # hard cap on total tool calls
traceOutput     = "./traces/mcp-proxy.jsonl"
onLoop          = "kill"      # "kill" | "warn" | "skip"

# Per-tool overrides — the key is the MCP tool name
[proxy.tools.web_search]
estimated_tokens = 500        # expected tokens per call
side_effect      = false

[proxy.tools.send_email]
side_effect      = true       # marks this tool as having real-world consequences
estimated_tokens = 200

[proxy.tools.create_invoice]
side_effect      = true
estimated_tokens = 1000
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
npx fuze-ai proxy --max-tokens 50000 --max-iterations 30 -- node server.js
```

## CLI options

| Flag               | Description                                          | Default                    |
|--------------------|------------------------------------------------------|----------------------------|
| `--max-tokens`     | Override `maxTokensPerRun` from `fuze.toml`          | from config or `100000`    |
| `--max-iterations` | Override `maxIterations` from `fuze.toml`            | from config or `50`        |
| `--trace`          | Path to the trace output file                        | `./fuze-proxy-traces.jsonl`|
| `--verbose`        | Print every intercepted tool call to stderr          | `false`                    |
| `--daemon`         | Connect to the Fuze daemon for live dashboard updates| `false`                    |

## What gets intercepted

The proxy intercepts every MCP `tools/call` request **before** it reaches the
underlying server:

1. **Token budget check** -- The per-tool `estimated_tokens` is compared against
   the session's remaining token budget. If the call would push the total past
   `maxTokensPerRun`, the call is blocked and a JSON-RPC error is returned to
   the client.

2. **Loop detection** -- The proxy tracks call patterns (repeated identical
   calls, no-progress sequences). If a loop is detected, the configured
   `onLoop` action fires (`kill`, `warn`, or `skip`).

3. **Side-effect tagging** -- Tools marked `side_effect = true` are flagged in
   the trace log. The proxy will not auto-retry these tools on transient
   failure.

4. **Trace recording** -- Every call (allowed or blocked) is appended to the
   trace file as a JSONL record with timing, estimated tokens, and the guard
   decision.

## Where traces go

By default, traces are written to `./fuze-proxy-traces.jsonl` (relative to the
working directory). Override with `traceOutput` in `fuze.toml` or `--trace`
on the command line.

Each line is a JSON object:

```jsonc
// Step record
{ "recordType": "step", "runId": "...", "toolName": "web_search", "estimatedTokens": 500, ... }

// Guard event (loop detected, budget exceeded)
{ "recordType": "guard_event", "runId": "...", "type": "budget_exceeded", "severity": "critical", ... }

// Run lifecycle
{ "recordType": "run_start", "runId": "...", "agentId": "mcp-proxy", ... }
{ "recordType": "run_end",   "runId": "...", "status": "completed", ... }
```

When `--daemon` is active, the same events are also pushed to the Fuze daemon
over a Unix socket (or named pipe on Windows), enabling real-time monitoring
via the dashboard.
