# @fuze-ai/agent-api-server

Reference HTTP server for `@fuze-ai/agent-api`. Hono-based, runs on Node 22+
(also Bun, Cloudflare Workers, Deno — but the reference build is Node).

## Position

Customers self-host this in their VPC. The dashboard and CLI talk to it.
Cloud is an opt-in transport, not a runtime requirement.

## Auth

Skeleton only. `BearerAuth` maps API keys to tenants from an in-memory map —
**replace with KMS / secret manager / mTLS in production**. The `Auth`
interface is the seam.

## Storage

The server is a thin shell. State lives in three injected stores:

- `SuspendStore` (from `@fuze-ai/agent-suspend-store`) — pending HITL runs.
- `DurableRunStore` (from `@fuze-ai/agent-durable`) — agent run snapshots.
- `SpansStore` (this package) — appended evidence chains.

For tests we ship `InMemorySpansStore`. Production uses SQLite (later).

## Long-poll

`GET /v1/runs/:runId/decisions?wait=N` holds the connection up to N seconds
waiting for a decision. Wakers are tracked per-run in process memory. Multi-
process deployments need an external pub/sub — the seam is `LongPollHub`.
