# `@fuze-ai/daemon`

Self-hosted runtime daemon. Receives telemetry from one or more SDKs over UDS / named pipe, persists the audit log, runs pattern detection, and serves kill-switch decisions back to SDKs in-flight.

This is a **transport target**, not part of the public SDK surface. Customers run it; they don't import from it. SDKs talk to it via the wire protocol — never via direct module import.

## Commands

```
npm run -w @fuze-ai/daemon build     # tsc → dist/
npm run -w @fuze-ai/daemon test      # vitest run
npm run -w @fuze-ai/daemon start     # run the built daemon
```

From repo root, `npm run daemon` runs the built daemon.

## Architecture

- `src/index.ts` — entry, wires the components and starts the listener
- `src/uds-server.ts` — UDS / named-pipe listener, accepts SDK connections
- `src/api-server.ts` — HTTP control surface for the dashboard
- `src/audit-store.ts` — append-only event log with hash-chain verification
- `src/budget-enforcer.ts` — applies `kill` / `pause` decisions on step-check
- `src/compensation/` — side-effect rollback hooks (planned)

## Conventions specific to this package

- One runtime dep (`ws`). Adding more requires explicit justification.
- Daemon must accept the same wire format from JS and Python SDKs identically. If a feature works for one and not the other, it's a daemon bug.
- Audit log integrity is the single most important property. Never short-circuit hash chain validation for performance.
- Listener should be unix-domain on Linux/macOS and named pipe on Windows. The selection happens at startup — no env var, just platform detection.

## Don't

- Don't add a runtime dependency on `fuze-ai` (the core package). Daemon receives bytes; it does not run user agents.
- Don't change the wire format without coordinating with both SDKs. See `.context/parity.md`.
- Don't ship a managed-cloud variant from this package. Cloud ingest is a separate codebase. This daemon is for self-host only.
