# Fuze AI

Runtime safety middleware for AI agents. Wraps your existing tools and functions with loop detection, budget enforcement, side-effect tracking, and audit logging.

Fuze is **not** a framework. It wraps any framework (LangGraph, CrewAI, ADK) or raw SDK calls via a single `guard()` function.

## Install

```bash
npm install fuze-ai
```

## Quick Start

```typescript
import { guard } from 'fuze-ai'

// Zero config — uses defaults
const search = guard(async function search(query: string) {
  return await vectorDb.search(query)
})

// With options
const sendInvoice = guard(
  async function sendInvoice(customerId: string, amount: number) {
    return stripe.createInvoice(customerId, amount)
  },
  { sideEffect: true, compensate: cancelInvoice, maxRetries: 1 }
)

// Cost ceiling
const analyse = guard(
  async function analyse(text: string) {
    return llm.complete(`Analyse: ${text}`)
  },
  { maxCost: 0.50, model: 'openai/gpt-4o', estimatedTokensIn: 1000, estimatedTokensOut: 500 }
)
```

## Multi-Step Runs

Use `createRun()` to share budget and loop detection across multiple steps:

```typescript
import { createRun } from 'fuze-ai'

const run = createRun('research-agent', { maxCostPerRun: 5.0 })

const search = run.guard(searchFn)
const analyse = run.guard(analyseFn, { maxCost: 1.0 })

await search('query')
await analyse('data')

console.log(run.getStatus()) // { totalCost, totalTokensIn, totalTokensOut, stepCount }
await run.end()
```

## Configuration

### Programmatic

```typescript
import { configure } from 'fuze-ai'

configure({
  defaults: {
    maxRetries: 3,
    timeout: 30000,
    maxCostPerRun: 10.0,
  },
  providers: {
    'openai/gpt-4o': { input: 0.0000025, output: 0.00001 },
  },
})
```

### File-based (fuze.toml)

Create a `fuze.toml` in your project root:

```toml
[defaults]
maxRetries = 3
timeout = 30000
maxCostPerStep = 1.00
maxCostPerRun = 10.00
maxIterations = 25
onLoop = "kill"
traceOutput = "./fuze-traces.jsonl"

[loopDetection]
windowSize = 5
repeatThreshold = 3
maxFlatSteps = 4
```

Priority: guard options > fuze.toml > built-in defaults.

## Guard Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `maxRetries` | `number` | `3` | Max retry attempts on failure |
| `timeout` | `number` | `30000` | Kill after this duration (ms) |
| `maxCost` | `number` | `Infinity` | Max USD for this step |
| `maxTokens` | `number` | — | Max tokens for this step |
| `maxIterations` | `number` | `25` | Hard iteration cap for the run |
| `sideEffect` | `boolean` | `false` | If true, Fuze won't auto-retry |
| `compensate` | `Function` | — | Compensation function for rollback |
| `onLoop` | `'kill' \| 'warn' \| 'skip'` | `'kill'` | Action on loop detection |
| `model` | `string` | — | Model identifier for cost estimation |

## Loop Detection

Three layers of protection:

1. **Iteration cap** — hard limit on total steps (default: 25)
2. **Repeated tool calls** — detects consecutive identical calls within a sliding window
3. **No-progress detection** — flags runs that produce no novel output

## Error Types

```typescript
import { BudgetExceeded, LoopDetected, GuardTimeout } from 'fuze-ai'
```

All errors include actionable messages:

```
BudgetExceeded: step 'analyse' estimated $0.6000 but step ceiling is $0.5000 (run spent $0.4200 of $0.5000)
LoopDetected: step 'search' repeated identical call 3 times in window of 5
GuardTimeout: step 'slowFn' exceeded timeout of 30000ms
```

## Trace Output

Every guarded execution produces JSONL traces at the configured output path (default: `./fuze-traces.jsonl`). Each line is a JSON object with a `recordType` field: `run_start`, `step`, `guard_event`, or `run_end`.

## Supported Models

Built-in pricing for: `openai/gpt-4o`, `openai/gpt-4o-mini`, `openai/o3-mini`, `anthropic/claude-sonnet-4`, `anthropic/claude-haiku-3.5`, `anthropic/claude-opus-4`, `google/gemini-2.0-flash`, `google/gemini-2.5-pro`, `deepseek/deepseek-chat`, `meta/llama-3.3-70b`.

Override or add models via `configure()` or `fuze.toml [providers]`.

## License

MIT
