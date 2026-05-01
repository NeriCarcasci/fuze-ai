# @fuze-ai/agent-suspend-store

SQLite-backed adapters for the Fuze Agent HITL (human-in-the-loop) lifecycle.

## Scope

Two implementations of interfaces declared in `@fuze-ai/agent`:

- `SqliteSuspendStore` implements `SuspendStore` (persist `SuspendedRun`, record `OversightDecision`, erase by GDPR subject).
- `SqliteNonceStore` implements `ResumeTokenStore` (one-shot resume-token nonce ledger).

Both take `{ databasePath: string }`. `:memory:` is supported for tests.

## Per-package extension: `saveWithSubject`

The `SuspendStore` interface (in `@fuze-ai/agent`) intentionally does not carry
`subjectHmac` on `SuspendedRun`, but `eraseBySubjectRef(subjectHmac)` needs that
mapping to delete by GDPR subject. `SqliteSuspendStore` adds a non-interface
method:

```ts
saveWithSubject(run: SuspendedRun, subjectHmac?: string): Promise<void>
```

Callers that have a subject reference should use `saveWithSubject`; callers that
do not should use the interface-conforming `save` (subject column is left NULL,
and the row is unreachable via `eraseBySubjectRef`). This is a per-package
extension and is **not** part of the cross-SDK public API.

## Runtime

Uses Node's built-in `node:sqlite` (Node 22+, currently flagged experimental;
the runtime emits an `ExperimentalWarning`). No native compilation step.
