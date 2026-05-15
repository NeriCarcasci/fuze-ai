# Proposal: full-interaction spans (v2 trace schema)

Status: accepted, in implementation.
Schema: [`data/trace-schema.json`](../data/trace-schema.json).

## Why

Today's `StepRecord` is `{ toolName, argsHash, tokensIn, tokensOut, latencyMs }`. It is enough for tamper-evidence and budgets, not enough to answer:

- "Show me the whole conversation that produced this output."
- "What is the agent failing at?"
- "Which retrievals returned chunks the model didn't cite?"
- "Which user intents are taking >P95 step counts?"

Without semantic role, parent linkage, and captured content, these are not derivable from the trace store. We have to either (a) require customers to use the opinionated agent framework (which most won't, for good reasons) or (b) extend the SDK primitives so the same conversation timeline falls out of plain decorators.

This proposal does (b). The agent framework keeps emitting the same spans — it just becomes a convenience layer, not a tax.

## What changes

Four additive fields on `StepRecord`, one new content-bearing payload, two new helpers in the public API. No breaking changes — pre-v2 records validate against the v2 schema after defaults apply.

### Fields added to `StepRecord`

| Field          | Type                                                                                     | Default        | Purpose                                                  |
|----------------|------------------------------------------------------------------------------------------|----------------|----------------------------------------------------------|
| `role`         | enum: `user \| assistant \| system \| tool \| llm \| retrieval`                          | `'tool'`       | Semantic role; drives dashboard rendering and aggregations. |
| `parentStepId` | uuid?                                                                                    | undefined      | Tree structure for nested tool calls.                    |
| `capture`      | enum: `hash \| full \| full+redact \| sampled`                                           | `'hash'`       | Whether `content` is recorded and how.                   |
| `content`      | discriminated union (see schema)                                                         | undefined      | Captured payload. Present iff `capture !== 'hash'`.      |
| `attrs`        | open record                                                                              | undefined      | Span-type-specific extras (jurisdiction, model name, …). |

### New public API (parity in JS + Python)

```ts
// JS
await fuze.run({ sessionId, userId, tenant }, async () => {
  await fuze.span({ role: 'user', capture: 'full', content: { kind: 'text', text: input } })
  const reply = await fuze.traced(callLLM, { role: 'llm', capture: 'full+redact' })(messages)
  await fuze.span({ role: 'assistant', capture: 'full', content: { kind: 'text', text: reply } })
})
```

```python
# Python
async with fuze.run(session_id=..., user_id=..., tenant=...):
    await fuze.span(role='user', capture='full', content={'kind': 'text', 'text': input})
    reply = await fuze.traced(call_llm, role='llm', capture='full+redact')(messages)
    await fuze.span(role='assistant', capture='full', content={'kind': 'text', 'text': reply})
```

- `run(...)` is an implicit run-scope context (AsyncLocalStorage / contextvars). No `runId` threading.
- `span(...)` records a leaf span at the current scope.
- `traced(fn, opts)` is the decorator/HOF form for wrapping existing functions.

`guard(fn)` continues to exist unchanged. It now emits `role: 'tool'`, `capture: 'hash'` by default — backwards compatible.

## Invariants

1. **Hash chain unaffected.** `canonicalize()` already sorts keys generically; new fields are part of the signed payload but require no algorithm change. The existing `verifyChain()` test must continue to pass with mixed pre-v2 + v2 entries in the same chain.
2. **`capture='full+redact'` is non-negotiable for regulated tenants.** Raw content runs through the redaction engine *before* recorder.recordStep. Unredacted content never enters the hash chain. Enforced in SDK code, not policy.
3. **No silent default upgrade.** `capture` defaults to `'hash'`. We never auto-elevate to `'full'`. Each span's capture mode is a deliberate developer decision so storage and retention obligations are explicit.
4. **Parity holds.** Every public surface in JS has a Python counterpart in the same PR. The parity test in `tests/parity/` is updated to cover the new shapes.

## Casing — pre-existing parity divergence

Per `.context/parity.md`, snake_case is canonical and the parity harness at `tests/parity/normalize.mjs` renames JS keys to snake_case before comparison. v2 follows the same rule: JS emits `parentStepId`, Python emits `parent_step_id`, harness normalizes. The fields `role`, `capture`, `content`, `attrs` are case-identical across languages.

The normalize harness must learn the new mapping `parentStepId → parent_step_id` as part of Phase 1/2.

## Out of scope for v2

- OTLP export.
- Embedding-based failure clustering.
- Eval-set replay from production data.
- A separate `RetrievalRecord` event type. (Retrieval is just a `role` value on `StepRecord`.)
- USD/cost telemetry. (Permanently out, per AGENTS.md.)

## Migration

- Existing JSONL files: no change. Defaults make pre-v2 records valid against v2.
- DB schema (`fuze-dashboard/cloud-api`): adds nullable columns + indexes. Reversible.
- Customer code: no required changes. `guard()` continues to work. Opt into the new API when ready.
