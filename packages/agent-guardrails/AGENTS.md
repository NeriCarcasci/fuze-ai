# @fuze-ai/agent-guardrails

First-party guardrail catalog for `@fuze-ai/agent`. Each export conforms to `FuzeGuardrail` from the agent package and is wired into a `GuardrailSet` by the host application.

## Status — Phase 0

- `piiGuardrail` — regex-only detector (email, E.164 phone, IBAN, IPv4, credit card with Luhn). Real Microsoft Presidio integration is **deferred to Phase 3**; the regex implementation is intentionally conservative and is not a substitute for proper PII recognition. Evidence reports counts only — never raw values.
- `promptInjectionGuardrail` — heuristic pattern scanner over tool results. Walks object payloads to scan all string leaves.
- `residencyGuardrail` — domain/TLD allowlist over output payloads. IP-block detection is deferred.

## Hard rules (this package)

1. No raw PII or secret values in evidence objects. Evidence is for audit; it must be safe to persist.
2. Guardrails are pure with respect to the payload. Do not call `ctx.invoke`, models, or network.
3. No `any` in public API. No `as` casts to silence the checker.
4. Phase is fixed per guardrail and reflected in the exported `FuzeGuardrail.phase`.
