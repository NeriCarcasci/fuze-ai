# Architecture invariants

State invariants in terms of *roles*, not symbols. Specific class and file names rot when refactored — the role is what's load-bearing.

## Layers

1. **Public API.** `guard`, `createRun`/`create_run`, `configure`, `registerTools`. The only surface external code touches. Anything else is internal and may change.
2. **Guard core.** Resource limit tracking, loop detection, side-effect registry, trace recording. Pure logic, no I/O. Same semantics in both SDKs.
3. **Trace recorder.** Hash-chained, append-only event log. Every event includes the previous event's hash. Verifiable end-to-end without trusting the recorder.
4. **Transport.** Pluggable. Three implementations: noop (in-process only), socket (self-hosted daemon over UDS/named pipe), cloud (HTTPS to managed ingest). Selected by config priority: cloud > socket > noop.
5. **Service layer.** Wraps the transport with retry, batching, and the higher-level RPCs (`register_tools`, `send_run_start`, etc.). Async by default.

## Invariants

**The public API is the only stable surface.** Anything in `internal/`, anything starting with `_` in Python, anything not exported from `index.ts` is fair game to refactor without notice. Don't write code that depends on internals from another package.

**Telemetry is opt-in zero-config.** A user who installs the SDK and calls `guard(fn)` with no config gets the noop transport — nothing leaves the process. Activation of cloud or socket transport is explicit (env var or config field). This is a compliance-critical default.

**The hash chain is sacred.** Trace events form a Merkle-style chain: every event's `prev_hash` is the hash of the previous event. `verifyChain` walks the chain and fails on any tampering. Never break the chain to "fix" a recorded event — the audit log is append-only by design.

**Loop detection is heuristic, not authoritative.** It catches obvious cycles (same args hash repeated, same tool call repeated). It does not prevent all infinite loops. The resource limit tracker is the actual bound — it always wins.

**Resource limits are enforced before action, not after.** A step whose pre-flight check exceeds the budget never runs. We never charge a user for tokens we already prevented from being spent.

**Side effects are tracked, not prevented.** The side-effect registry is observability, not enforcement. Compensation logic is the user's responsibility. We give them the audit trail to build it.

## What's load-bearing

If you change any of these, half the codebase ripples — read `.context/parity.md` first:

- The trace event field set
- The hash chain algorithm
- The `GuardOptions` and `FuzeConfig` shapes
- The transport interface (what a transport must implement)
- The service RPC set
- The error class hierarchy

## What's not load-bearing

These can change freely:

- File layout inside any package
- Internal helper signatures
- Test organization
- Build output structure (other than the package's exported entry)
- Daemon's internal storage format (it's an implementation detail of the socket transport)

## Out-of-scope (do not build)

These have been actively rejected, not "not yet built":

- USD / cost / currency tracking — see `.context/product.md`
- LLM model routing or fallback orchestration — that's an agent framework's job, not a safety layer's
- Prompt template management
- Vector store integration
- Anything user-facing beyond the SDK and dashboard

The boundary is: we observe and constrain agent execution. We do not orchestrate it.
