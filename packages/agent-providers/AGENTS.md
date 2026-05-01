# @fuze-ai/agent-providers

EU-resident model provider adapters for `@fuze-ai/agent`. Each adapter implements `FuzeModel` with `residency: 'eu'`.

## Scope (Phase 4)

Three providers, all OpenAI-compatible chat-completions over HTTP via global `fetch`:

1. `mistralModel` — Mistral La Plateforme (Paris, EU)
2. `scalewayModel` — Scaleway Inference (FR, EU)
3. `ovhModel` — OVHcloud AI Endpoints (FR, EU)

## Hard rules (this package)

1. **No real network calls in tests.** Every adapter accepts an injectable `fetchImpl?` so vitest stubs the wire. Integration tests with real API keys are out of scope for Phase 0.
2. **No extra runtime deps.** Global `fetch`, no axios, no zod-to-json-schema. JSON schema generation is a minimal manual converter (z.object / z.string / z.number / z.boolean) and is internal.
3. **Residency is a type-level claim, not a runtime check.** Each provider hard-codes `residency: 'eu'`. Misrouting a non-EU endpoint via these adapters is a bug at the call site — surface it; do not silently flip residency.
4. **Provider error → finishReason `'error'`.** Non-2xx HTTP and JSON parse failures throw; the loop owns retry policy.

## Status

Phase 4 scaffolding. Wire shape and response parsing only. No streaming, no tool-result re-entry beyond the existing `ModelStep` contract.
