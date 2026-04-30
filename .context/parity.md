# JS ↔ Python Parity

The single most load-bearing rule in this repo. Fuze ships two SDKs that emit the same telemetry, accept the same config, and present the same public API. They are not independent — they are two implementations of one specification.

## What MUST match

**Public API surface.** Every public function, decorator, or class in one SDK has a counterpart in the other. Naming follows language conventions (`createRun` ↔ `create_run`, `registerTools` ↔ `register_tools`) but semantics, parameters, and return shapes are identical.

Currently:
- `guard(fn, options)` — JS HOF wrapper / Python decorator
- `createRun() / create_run()` — returns a run context with `guard`, `getStatus/get_status`, `end`
- `configure(config)` — sets global config
- `resetConfig() / reset_config()` — clears global config
- `registerTools(tools) / register_tools(project_id, tools)` — register tool definitions with a service
- `extractUsageFromResult / extract_usage_from_result` — parse provider responses
- `verifyChain(...)` — verify trace hash chain integrity

**Config keys.** `fuze.toml` is parsed by both SDKs. Every key works in both, or it works in neither. Same for environment variables (`FUZE_API_KEY`, `FUZE_DAEMON_*`, etc.).

**Trace event schema.** Every `step_start`, `step_end`, `run_start`, `run_end`, `tool_call`, etc. emitted by JS must be byte-identical (after JSON normalization) to what Python emits for the same logical event. Field names, types, optional vs required, nested object shape — all match.

**Wire protocol.** Daemon transport (UDS / named pipe) and Cloud transport (HTTPS) accept the exact same payloads from either SDK. The daemon and ingest API don't know or care which language sent the bytes.

**Errors.** `LoopDetected`, `GuardTimeout`, `ResourceLimitExceeded`, `FuzeError` exist in both. Same hierarchy, same fields on the error object.

## What does NOT have to match

- File layout inside the package. JS uses `packages/core/src/`, Python uses `packages/python/src/fuze_ai/`. Internal module organization is per-language.
- Async model. JS is async-by-default; Python supports both sync and async via inspection. The wrapper just has to handle both correctly.
- Internal helpers. `_build_context`, `createGuardWrapper`, etc. are private and may diverge.
- Build/test tooling. Vitest for JS, pytest for Python.
- Performance characteristics. We don't pretend they're equal.

## When you change one, you change both

A PR that touches public API, config, schema, or wire protocol in only one SDK is **not mergeable**. Either:

1. Land the matching change in the other SDK in the same PR, or
2. Open a parity-tracking issue and put the divergence behind a flag with a deadline.

Option 2 is rarely the right call. Default to option 1.

## Parity checklist (use before opening any PR that touches public surface)

- [ ] Public function added/changed in JS — counterpart added/changed in Python
- [ ] New config key — parsed by both ConfigLoaders, documented in `fuze.toml.example`
- [ ] New trace event field — emitted by both, schema doc updated
- [ ] New error class — exists in both with same hierarchy
- [ ] New transport behavior — both SDKs send the same bytes
- [ ] Test coverage in both languages, not just one
- [ ] `examples/` updated in both languages if the change is user-visible

## Wire format reference

The authoritative trace event schema lives at `data/trace-schema.json` (planned). Until that file exists, the JS `TraceRecorder` in `packages/core/src/trace-recorder.ts` is the de-facto source of truth — Python mirrors it exactly. Any drift discovered during review is a JS bug or a Python bug, never "by design."

## Why this matters

Customers running mixed JS+Python agent stacks (LangGraph orchestrator + JS tool runner, etc.) will see one logical run as two streams of telemetry. If the schemas drift, the dashboard and audit log become incoherent. EU compliance posture depends on the audit log being a single coherent ledger. Parity is not a nice-to-have.
