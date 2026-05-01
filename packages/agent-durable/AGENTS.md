# @fuze-ai/agent-durable

SQLite-backed snapshot store for Fuze Agent run execution state.

## Scope

`SqliteDurableRunStore` persists a `DurableRunSnapshot` at each step boundary so a suspended run can be resumed after a process restart. Companion to `@fuze-ai/agent-suspend-store`: that package holds the cryptographic suspend record; this one holds the loop's execution state (history, completed tool calls, steps/retries used, chain head).

## Status

Phase 1. Used by Phase 2 resume orchestration to replay execution from the last persisted boundary.

## Data hygiene

Snapshots flow through the same redactor as evidence spans before reaching this layer. PII does not enter `history_json` or `completed_tool_calls_json`. `subjectHmac` is the only subject-linked column and exists for GDPR erasure cascade only.

## Idempotency

`completedToolCalls` carries `argsHash` + `outputHash` (sha256 over `canonicalize(...)` from `@fuze-ai/agent`) per call. On resume, callers consult these hashes to skip tool calls whose side effects have already executed.

## Orphan tracking

`resolved_at` defaults to NULL. Call `markResolved(runId)` when the run reaches a terminal state. `listOrphaned(olderThan)` returns runIds whose snapshot is older than `olderThan` and `resolved_at IS NULL` — surfacing suspended runs that were never decided.

## Runtime

Uses Node's built-in `node:sqlite` (Node 22+, currently flagged experimental; the runtime emits an `ExperimentalWarning`). `:memory:` is supported for tests.
