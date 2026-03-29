# Example 02 - Budget Ceiling

Demonstrates how Fuze AI enforces per-step and per-run cost ceilings to prevent runaway LLM spend.

## What it demonstrates

- Using `configure()` to set a global run-level budget (`maxCostPerRun: 1.00`)
- Registering a custom provider pricing table so Fuze can estimate costs from token counts
- Setting a per-step ceiling with `guard(fn, { maxCost: 0.30 })`
- Catching `BudgetExceeded` errors and inspecting their properties (`level`, `estimatedCost`, `ceiling`, `spent`)

## How it works

Each call to `analyseChunk` is annotated with `model: 'openai/gpt-4o'` and estimated token counts. Fuze multiplies tokens by the provider rates to get an estimated cost *before* executing the function. If the estimate exceeds the step ceiling or would push the run total past the run ceiling, a `BudgetExceeded` error is thrown and the function is never called.

With an estimated cost of ~$0.40 per call and a $0.30 step ceiling, the very first call should be blocked at the step level. If the step ceiling were raised, the $1.00 run ceiling would kick in after a few calls.

## How to run

```bash
npm install
npm start
```

## Expected output

The first call is blocked because the estimated cost (~$0.40) exceeds the per-step ceiling ($0.30). Subsequent calls are similarly blocked. The exact output depends on which ceiling is hit first (step or run).

```
Fuze AI -- Budget Ceiling Example

Run ceiling : $1.00
Step ceiling: $0.30
Est. cost/call: ~$0.40 (80K in + 20K out at gpt-4o rates)

Step 1 BLOCKED: BudgetExceeded: step 'analyseChunk' estimated $0.4000 but step ceiling is $0.3000 ...
  level    : step
  estimated: $0.4000
  ceiling  : $0.3000
  spent    : $0.0000
...
```

## What to look for in the trace

- Steps that were blocked will have an `error` field containing `"BudgetExceeded"`
- The `costUsd` field shows the estimated cost that would have been incurred
- No actual function execution happens for blocked steps -- the guard stops them pre-flight
