# @fuze-ai/agent

TypeScript agent framework. EU compliance evidence baked in at the type-system level. Layered on `fuze-ai` (the safety SDK) — uses its hash-chained trace recorder, transports, and audit log infrastructure rather than reimplementing them.

## Position

This is a **separate product** from the safety SDK. The safety SDK is a middleware that wraps any agent code (LangChain, mastra, hand-rolled). The agent package is an opinionated framework for teams building agents from scratch with compliance-by-construction.

JS/Python parity rule (root AGENTS.md, rule 2) applies to the safety SDK's public API. This package is TS-first; a Python sibling may follow but is not a launch requirement.

## Hard rules (this package)

1. **Compliance fields are type invariants, not lint rules.** `FuzeTool` is a discriminated union over `dataClassification`. The compiler refuses tools that omit `art9Basis` for special-category data, `subjectRef` in `Ctx` when classification ≠ `'public'`, or `retention` on any tool.
2. **The loop is non-bypassable.** Tools never receive sibling tools. Internal composition goes through `ctx.invoke(name, input)`, which re-enters the evidence pipeline. Tools cannot call models. Guardrails get a restricted model handle.
3. **Retry budget belongs to the loop only.** Providers run with `maxRetries: 0`. Tools return `Result<T, Retryable>`. The loop decides whether to retry and counts retries against `maxSteps`.
4. **Cerbos failure is fail-stop.** A policy engine error halts the run with `fuze.policy.engine_error=true`. There is no allow-on-error path at runtime.
5. **No raw secrets in spans.** `Ctx.secrets` returns opaque `SecretRef`. The pre-export redactor strips known secret shapes.

## Package layout

```
src/
  index.ts          public API
  types/            discriminated unions: FuzeTool, Ctx, Result, Retention, ThreatBoundary, Art9Basis
  loop/             owned agent loop
  evidence/         RFC 8785 canonicalization, hash chain wrapper, redaction
  policy/           Cerbos gate (stub for now; real wiring deferred)
  guardrails/       input + toolResult + output phases
  agent/            defineAgent, defineTool factories
test/
```

## Status

Phase 0 (spine) is the focus. Phases 1–5 (sandbox adapters, MCP host, EU providers, sovereign infra, GA) are scaffolded but not implemented. See `_planning` history (deleted) and the user's product plan for context.
