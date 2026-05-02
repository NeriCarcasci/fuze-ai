# Milestone B — span schema versioning + tool.partial + bashStreamTool

## Status

Shipped, 2026-05-02.

## What landed

### 1. Span schema versioning

- `EvidenceSpan` gained an optional `spanSchemaVersion?: number`.
- `CURRENT_SPAN_SCHEMA_VERSION = 1` exported from `@fuze-ai/agent`.
- `verifyChain` accepts `{ acceptedSchemaVersions?: { min, max } }`,
  default `{ min: 1, max: 1 }`.
- v1 spans **omit** the field from the emitted object — canonical form for
  v1 is unchanged, so all pre-existing signed chains still verify byte-for-byte.
- ADR at `packages/agent/docs/adr/0001-span-schema-versioning.md` documents
  the rule, the canonical-form invariant, what counts as a breaking change,
  and the v2 migration path.

### 2. `tool.partial` span kind

- New span name `tool.partial`. Reuses existing `role: 'tool'`. No new role
  enum value (the constraint that `SpanRole` is a closed union is preserved
  for now; the `span` field is the discriminator).
- Shape: same envelope as any tool span; carries
  `fuze.partial.sequence_number: number` and
  `fuze.partial.final_chunk: boolean` in `attrs`.
- Each chunk hashes/chains independently — the hash chain is unaware of the
  partial structure.

### 3. `Ctx.emitChild` (smallest API addition)

- Added `emitChild?: (input: EmitChildInput) => void` to `Ctx`. Optional —
  not all tools need it; absent in test stubs/conformance Ctx literals.
- Wired by the agent loop (`buildToolCtx` in `loop.ts`) and by
  `executeApprovedTool`. Bound to `EvidenceEmitter.emit` with
  `role: 'tool'` and the current `stepId` of the tool execution.
- Justification: tools previously could only annotate via `ctx.attribute`,
  which folds into the bracketing `tool.execute` span. Streaming requires
  emitting *separate* spans between `tool.start` and `tool.end`. Doing it
  through `ctx.invoke` was wrong (that re-enters the loop with a sibling
  tool); doing it directly via `EvidenceEmitter` from a tool would violate
  hard rule 1 in `packages/agent-tools/AGENTS.md` (no host I/O / no direct
  emitter access). `emitChild` is the smallest surface that unblocks this
  while leaving the loop in charge of stepId and chain ordering.

### 4. `bashStreamTool`

- New file `packages/agent-tools/src/bash-stream.ts`.
- Same deps as `bashTool` (`{ sandbox, retention }`).
- Emits a `tool.partial` span per stdout chunk with the chunk content under
  the redaction-and-retention path the emitter already provides.
- Returns an aggregated `{ stdout, stderr, exitCode, durationMs, tier,
  chunkCount }` envelope.
- Sandbox failure returns `Retry` exactly like `bashTool`.

### 5. Sandbox plumbing

- `JustBashSandbox` (`packages/agent-sandbox-justbash/src/sandbox.ts`)
  gained a `bash_stream` synthetic verb. Translates JSON stdin
  `{ command, stdin? }` into a real `bash` call, splits stdout by newlines
  to produce chunks, and returns
  `{ chunks: string[], stderr, exitCode }` as JSON on stdout.
- `FakeSandbox` test helper (`packages/agent-tools/test/fake-sandbox.ts`)
  has a matching `bash_stream` handler used by the tool tests.

## Tests

- `@fuze-ai/agent`: 81/81 pass (was 77; 4 new in `hash-chain.test.ts`
  covering version default, explicit v1, range-check rejection of v2, and
  the canonical-equivalence regression).
- `@fuze-ai/agent` integration: `test/integration/tool-partial-chain.test.ts`
  runs an end-to-end agent loop with a streaming tool, confirms three
  `tool.partial` spans appear between `tool.execute` and the chain still
  passes `verifyChain`.
- `@fuze-ai/agent-tools`: 49/49 pass (5 new bash-stream tests).
- `@fuze-ai/agent-sandbox-justbash`: 38/38 pass (5 skipped real-bash live
  tests, unchanged).

## Type-check status

- `@fuze-ai/agent`: clean for everything in scope. `src/quickstart/index.ts`
  has a pre-existing TS2558 from M2's parallel `defineAgent` signature
  change; out of scope for milestone B.
- `@fuze-ai/agent-tools`: `tsc --noEmit` clean.
- `@fuze-ai/agent-sandbox-justbash`: `tsc --noEmit` clean.

## Constraints checked

- **Canonical hash regression.** New test in `hash-chain.test.ts`,
  "preserves canonical-form invariant for v1", computes a hash with
  `canonicalize` directly (simulating the pre-change path) and asserts it
  equals what `HashChain.append` produces post-change. Passes.
- **No provider/M2 file scope touched.** No edits in `agent-providers`,
  `define-agent.ts`, or `types/model.ts` from this milestone.

## Follow-ups

- The current spec ties chunk ordering to `(runId, stepId, toolName,
  sequenceNumber)`. This is sufficient for streaming a single tool call,
  but workflows with parallel branches will produce overlapping
  partial-streams; M3 must decide whether `stepId` is enough or whether
  partial spans need a `parentToolCallId`.
- `tool.partial` content is currently the chunk string under
  `{ chunk: ... }`. If a future tool emits binary chunks, the chunk would
  need a content-addressed externalization story (same problem as M4 browser
  screenshots; punted for now).
- We did not add a separate `SpanRole` enum value for partials. If the
  Annex IV mapper grows fine-grained role-based logic, it may want one;
  revisit when the mapper sees the new spans.

## Files changed

- `packages/agent/src/evidence/emitter.ts` — added
  `CURRENT_SPAN_SCHEMA_VERSION`, optional `spanSchemaVersion` on
  `EvidenceSpan`.
- `packages/agent/src/evidence/hash-chain.ts` — `verifyChain` accepts
  `VerifyChainOptions`; default range `{1,1}`.
- `packages/agent/src/types/ctx.ts` — added `EmitChildInput` and optional
  `emitChild` on `Ctx` and `CtxBuildInput`.
- `packages/agent/src/loop/loop.ts` — wires `emitChild` for tool
  executions.
- `packages/agent/src/loop/execute-approved.ts` — wires `emitChild` for
  approved-tool executions.
- `packages/agent/src/index.ts` — re-exports `VerifyChainOptions` and
  `CURRENT_SPAN_SCHEMA_VERSION`.
- `packages/agent/test/hash-chain.test.ts` — 4 new tests.
- `packages/agent/test/integration/tool-partial-chain.test.ts` — new.
- `packages/agent/docs/adr/0001-span-schema-versioning.md` — new.
- `packages/agent-tools/src/bash-stream.ts` — new.
- `packages/agent-tools/src/index.ts` — re-exports.
- `packages/agent-tools/test/bash-stream.test.ts` — new.
- `packages/agent-tools/test/fake-sandbox.ts` — `bash_stream` handler.
- `packages/agent-sandbox-justbash/src/sandbox.ts` — `bash_stream` verb.
