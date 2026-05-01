# @fuze-ai/agent-sandbox-e2b

E2B microVM sandbox adapter implementing `FuzeSandbox` from `@fuze-ai/agent`. Wraps E2B's `Sandbox` SDK with per-`(tenant, runId)` isolation, pause/resume, and timeout enforcement.

## Tier resolution

- `tier: 'vm-managed'` — `E2B_DOMAIN` unset. Uses E2B's managed cloud, **US-region**. Not suitable for EU residency requirements; use the self-hosted tier or an in-region adapter for `Residency: 'eu'` workloads.
- `tier: 'vm-self-hosted'` — `E2B_DOMAIN` set. Customer-operated infrastructure. Sovereignty / residency posture is whatever the operator's deployment provides.

## Threat boundary

`trustedCallers: ['agent-loop']`, `observesSecrets: false` (the microVM is isolated from the host), `readsFilesystem: true`, `writesFilesystem: true`. `egressDomains` is supplied at construction; nothing is implicit.

## Integration status

Real `e2b` SDK wiring deferred; tests use `FakeE2BClient`. The `E2BClientFactory` interface is the seam — production wiring instantiates `e2b`'s `Sandbox.create` behind it. `e2b` is an `optionalDependencies` so the package builds without it.

Phase 2: `RealE2BClientFactory` wraps the real `e2b` package. Tests use `FakeE2BClient`. The factory dynamically imports `e2b` on `create()` / `resume()` and throws `E2BNotInstalledError` when the package is missing, leaving the constructor cheap and safe even without `E2B_API_KEY`.

## Notes

- Per `(tenant, runId)` keying — distinct runs get distinct microVMs. `dispose()` kills all live sandboxes.
- `pause()` / `resume(id)` are exposed via the client interface; the adapter uses them only when the loop requests suspension.
