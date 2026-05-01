# @fuze-ai/agent-memory

Memory adapters for the Fuze Agent framework. Implements `FuzeMemory` from `@fuze-ai/agent`.

## Position

Conversation/semantic memory — mutable, customer-pluggable. Distinct from the loop-owned StepLog (immutable, evidence-grade). Adapters here may be swapped without touching the loop.

## Hard rules (this package)

1. **Per-tenant key isolation.** Reads and writes are keyed by `(tenant, runId)`. Cross-tenant leakage is a correctness bug.
2. **Subject-keyed erasure.** `erase(subjectRef)` removes every entry tagged with that `subjectRef.hmac` across all tenants/runs. Required for GDPR Art. 17.
3. **No plaintext at rest in `EncryptedMemory`.** The wrapper applies AES-256-GCM before delegating to the inner adapter; the inner adapter must never observe plaintext messages.

## Status

Phase 0. Ships two adapters:

- `InMemoryMemory` — Map-backed, process-local. Suitable for tests and single-process runs.
- `EncryptedMemory` — wraps any `FuzeMemory` and encrypts content at rest with a caller-supplied 32-byte key.

No Mastra adapter yet. Deferred to Phase 1+ when we wire the Mastra integration.
