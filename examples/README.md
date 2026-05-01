# Fuze AI Examples

Small, focused examples of Fuze's runtime safety surface. Each example is mirrored 1:1 between TypeScript and Python and uses the decorator pattern (`guard()` wrapping in TS, `@guard` in Python). The non-Fuze parts (LLM responses, side-effect targets) are minimal in-process fakes — every Fuze call is real.

## Examples

| # | Demonstrates | TypeScript | Python |
|---|---|---|---|
| 01 | Wrapping one tool with the guard decorator | [typescript/01-basic-guard](typescript/01-basic-guard/) | [python/01-basic-guard](python/01-basic-guard/) |
| 02 | Per-run token ceiling enforcement | [typescript/02-budget-ceiling](typescript/02-budget-ceiling/) | [python/02-budget-ceiling](python/02-budget-ceiling/) |
| 03 | Loop detection on repeated identical calls | [typescript/03-loop-detection](typescript/03-loop-detection/) | [python/03-loop-detection](python/03-loop-detection/) |
| 04 | Side-effect tracking with compensation | [typescript/04-side-effects](typescript/04-side-effects/) | [python/04-side-effects](python/04-side-effects/) |
| 05 | Shared run across multiple agents | [typescript/05-multi-agent](typescript/05-multi-agent/) | [python/05-multi-agent](python/05-multi-agent/) |
| 06 | Zero-code MCP server protection (CLI) | [typescript/06-mcp-proxy](typescript/06-mcp-proxy/) | — |

## Running

```bash
# TypeScript
cd typescript/01-basic-guard
npm install
npm start

# Python
cd python/01-basic-guard
pip install fuze-ai
python main.py
```

Every example writes a `fuze-traces.jsonl` file you can inspect.

## What to look for in a trace

Each line is a JSON record:

- **`run_start`** — beginning of a run (agent ID, config)
- **`step`** — one tool call (timestamps, latency, token usage, args hash)
- **`guard_event`** — a Fuze intervention (loop detected, token ceiling crossed, timeout)
- **`run_end`** — completion with final status
