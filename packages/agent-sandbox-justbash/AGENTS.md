# @fuze-ai/agent-sandbox-justbash

`FuzeSandbox` adapter wrapping the `just-bash` npm package.

## Scope

One `Bash` instance per `(tenant, runId)` pair, kept warm so `cwd`, `env`, and the virtual filesystem persist across `exec` calls within a run. Logger and fetch hooks forward to evidence-style callbacks (`onLog`, `onFetch`).

## Threat boundary

- Tier: `in-process` — `just-bash` runs in the host JS process with no VM isolation. Documented in security review C2.
- `trustedCallers: ['agent-loop']`, `observesSecrets: true`, `readsFilesystem: true`, `writesFilesystem: true`.
- `egressDomains` from constructor `allowedFetchPrefixes` (defaults to `'none'`).

## Single-tenant requirement

Mirrors `InProcessSandbox`: a `TenantWatchdog` records every observed tenant and refuses a second tenant within a 1-hour window with `SandboxRefusedError`. Multi-tenant deployments must use a VM-backed sandbox.

## Integration status

The real `just-bash` factory is wired in Phase 1 final integration. Tests use `FakeBashFactory`; the `BashFactory` interface here is the seam. `just-bash` is in `optionalDependencies` so installation proceeds even without it.

Phase 2: `RealBashFactory` wraps the real `just-bash` package. Operators install it explicitly. Tests use `FakeBashFactory`. `RealBashFactory.create()` lazily requires `just-bash` and throws `JustBashNotInstalledError` when the package is absent.
