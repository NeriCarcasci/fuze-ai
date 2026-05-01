# @fuze-ai/agent-redaction

Pluggable PII redaction for `@fuze-ai/agent`. Replaces the Phase 1 regex-only guardrail with a layered system operators can extend.

## Engines

- `RegexRedactionEngine` — baseline. Country phones (DE/FR/IT/ES/UK), national IDs (DE Steuer-ID, FR INSEE, IT Codice Fiscale), enriched IBAN, IPv6, MAC, JWT, OAuth bearer.
- `PresidioSidecarEngine` — opt-in classifier. Talks to a Python Presidio process via `SidecarTransport` (JSON-RPC). Real `ChildProcessSidecarTransport` ships, but Presidio itself is not bundled — operators install it. Tests use `FakeSidecarTransport`.
- `LayeredRedactionEngine` — composes engines with `union` (any flag triggers) or `intersection` (only common findings) merge mode.

## Fail-closed posture

If a classifier engine errors, times out, or returns unparseable JSON-RPC, it returns `confidence: 0` and emits a `Finding` with `kind: 'classifier-error'`. The downstream guardrail trips. Silent fallthrough is forbidden — an unhealthy classifier must be visible.

## Hard rules (this package)

1. No raw PII in `RedactionResult.findings`. Counts and field paths only.
2. No `any` in public API. No `as` casts to silence the checker.
3. The integration helper writes to `evidence` under `fuze.redaction.*` keys only. Do not collide with other guardrail namespaces.
4. Engines are pure with respect to input. No model calls, no `ctx`.
