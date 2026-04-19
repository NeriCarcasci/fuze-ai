# Fuze AI Examples

Working examples demonstrating Fuze's runtime safety features.

## TypeScript

| Example | Demonstrates |
|---|---|
| [01-basic-guard](typescript/01-basic-guard/) | Wrapping a function with `guard()` |
| [02-budget-ceiling](typescript/02-budget-ceiling/) | Token ceilings — agent killed at 100,000 tokens |
| [03-loop-detection](typescript/03-loop-detection/) | Catching repeated identical tool calls |
| [04-side-effects](typescript/04-side-effects/) | Side-effect tracking with compensation |
| [05-multi-agent](typescript/05-multi-agent/) | Multiple agents sharing a token ceiling via `createRun()` |
| [06-mcp-proxy](typescript/06-mcp-proxy/) | Zero-code MCP server protection |

## Python

| Example | Demonstrates |
|---|---|
| [01-basic-guard](python/01-basic-guard/) | `@guard` decorator basics |
| [02-budget-ceiling](python/02-budget-ceiling/) | Token ceilings in Python |
| [03-loop-detection](python/03-loop-detection/) | Loop detection in Python |
| [04-side-effects](python/04-side-effects/) | Side-effects with `@guard` |
| [05-langgraph-adapter](python/05-langgraph-adapter/) | `@fuze_tool` with LangGraph |

## Running

```bash
# TypeScript
cd typescript/01-basic-guard
npm install
npx tsx index.ts

# Python
cd python/01-basic-guard
pip install fuze-ai
python main.py
```

Every example produces a `fuze-traces.jsonl` file you can inspect.

## What to look for

After running an example, open the generated `fuze-traces.jsonl` file. Each line is a JSON record:

- **`run_start`** — marks the beginning of a run with agent ID and config
- **`step`** — one tool call with timestamps, latency, token usage, and args hash
- **`guard_event`** — a Fuze intervention (loop detected, token ceiling crossed, timeout)
- **`run_end`** — marks completion with final status
