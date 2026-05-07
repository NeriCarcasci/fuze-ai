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
                    plus: plan, role, dispatch, ledger, replay, oversight-v2
  loop/             owned agent loop (planning + dispatch wired in)
  evidence/         RFC 8785 canonicalization, hash chain wrapper, redaction, onEmit hook
  policy/           Cerbos gate (stub for now; real wiring deferred)
  guardrails/       input + toolResult + output phases
  agent/            defineAgent, defineTool, defineAgentRole, fromMarkdown,
                    dispatch-builder, dispatch-tools
  plan/             PlanState (immutable IDs, append-only revisions, auto-capture)
                    + plan-tools factory (commit_plan / update_plan_step / revise_plan)
  oversight/        durable-adapter, requestOversight, resolveOversight (Restate-shaped)
test/
```

## The agent model in one paragraph

A Fuze project has a folder of **agents** and a folder of **roles**. Agents are top-level
peers external code invokes by name; each carries full compliance metadata
(`purpose`, `lawfulBasis`, `annexIIIDomain`, etc.) and behavioral surfaces
(`instructions`, `context`). Roles are capability envelopes — they declare what
tools, data classes, and residency a child can operate under, without claiming a
specific task. Agents dispatch to roles at runtime with a freeform task brief,
fanning out in parallel under a per-parent concurrency cap. Plans are first-class
in-band: agents commit to a plan via auto-injected tools, update step status as
they execute, and every step links to the evidence rows it produced. Instructions,
context, plans, dispatches, and child sub-chains are all hashed into the same
hash-chained evidence ledger that already covers tools, models, and outputs.

## Hard rules (additions to the loop)

6. **Step IDs are immutable across plan revisions.** Splits create new IDs with `derivedFrom: [old]`. Removed steps get `status: 'superseded'` (evidence stays linked). Once a step is `done`, it stays `done`.
7. **Auto-capture is opt-out.** Evidence rows emitted while a plan step is `in_progress` are auto-linked to that step. `linkageSource: 'auto' | 'explicit' | 'corrected'` is recorded on each transition.
8. **Children are capability envelopes, not named agents.** `defineAgentRole` defines an envelope; `canDispatch` lists envelopes the parent can dispatch into. The runtime auto-generates one typed `dispatch_<role>` tool per envelope.
9. **No metadata inheritance across dispatch.** Roles declare their own `lawfulBasis`, `dataClassification`, `residency`. Children cannot operate under the parent's compliance posture.
10. **Forwarding is opt-in.** `requiresTenant` / `requiresPrincipal` on a role auto-forward those values; otherwise the parent must list them in `forward: [...]`. Default forward set is empty (fail-closed).
11. **`producesArt22Decision: true` + snapshot drift on resume = refuse.** Reviewer who wants to proceed must pass `allowModelDrift: true` after explicit acknowledgment. Non-Art22 runs warn but proceed. System-fingerprint-only drift never blocks.
12. **`expectedDeterminism: 'best-effort' | 'none'`** on every model-call ledger row. We never claim reproducibility we can't deliver.
13. **`ctx.requestOversight()` is durable.** Suspends through `DurableExecutionAdapter` (Restate in production, in-memory for tests). Suspend + resume are two distinct evidence entries; the modify-decision creates a chain fork pointing at the human's substituted args.

## Public API surface (current)

Defined by `src/index.ts`:
- `defineAgent`, `defineTool`, `defineAgentRole`, `fromMarkdown` (+ `fromMarkdown.dir`)
- `runAgent`, `resumeRun`, `ModelDriftAtResumeError`
- `PlanState`, `buildPlanTools`, `synthesizeDispatchTool`, `buildDispatchTools`
- `requestOversight`, `resolveOversight`, `InMemoryDurableAdapter`
- Type exports for `AgentRoleDefinition`, `DispatchResult<T>`, `AgentErrorCategory`, `PlanEvent`, `ReplayMode`, `OversightDecision`, full ledger entry types, etc.

Changes to this surface are JS↔Python parity-tracked per root AGENTS.md.

## Status

Phase A (single-agent + planning + evidenced) and Phase B (capability envelopes) wired into the loop. Phase C (Article 14 oversight) ships the in-memory durable adapter; the Restate adapter lives in `@fuze-ai/agent-durable` (sibling package, not yet implementing the v2 contract). Phase D (replay execution, OTel exporter, four-eyes mode) deferred — types and hooks are in place.
