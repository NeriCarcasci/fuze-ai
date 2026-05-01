# @fuze-ai/agent-mcp

MCP (Model Context Protocol) host wrapper for the Fuze agent framework. Wraps `@modelcontextprotocol/sdk`'s `Client` to intercept every `tools/call` JSON-RPC frame and emit Fuze evidence, gate via Cerbos, and apply admission policy.

## Position

Sibling to `@fuze-ai/agent`. Depends on it for `FuzeTool` types and evidence primitives. Never reaches into the agent loop directly — MCP-discovered tools are surfaced as ordinary `FuzeTool`s and re-enter the loop's evidence pipeline.

## Hard rules (this package)

1. **Discovered tools are unverified.** Every MCP tool ingested via this package starts as untyped JSON Schema. Operators must supply `UnverifiedToolMetadata` (classification, retention, threat boundary, lawful bases) explicitly — there is no implicit default.
2. **Admission is closed-list.** A server's `McpAdmission` enumerates which tool names are allowed. Tools outside the list are dropped at admission time.
3. **No raw schema trust.** Discovered input schemas are accepted as `z.unknown()` at the type level; runtime validation happens against the operator-supplied Zod shape, not the upstream JSON Schema.
4. **`in-process` sandbox tier is forbidden for MCP servers.** Admission is refused at validation time. MCP servers run out-of-process.
5. **Server fingerprints are pinned on first admission.** Rotation without re-approval throws `FingerprintMismatchError`.

## Status

Phase 2 in progress. Real MCP wiring layered behind a `McpTransport` seam:

- `McpClientHost` is the production host. It wraps any `McpTransport` with a `RecordingTransport` decorator that captures every `tools/call` request and response and forwards it to the injected `onCall` observer for evidence emission.
- `@modelcontextprotocol/sdk` is an **optional** dependency. The package never imports it at the type-system level — the `McpTransport` interface is the seam. Production wiring will adapt the SDK's transport to that interface; tests use `FakeMcpTransport`.
- `LazyToolRegistry` enforces a token budget across multiple admitted servers. Default budget is 8000 (estimated as `chars / 4`). Soft-warns at 80% of budget; on overflow, drops by description length (largest first) and reports `droppedToolNames` to `onBudgetExceeded`.
- `StubMcpHost` is retained for callers that pre-build their `FuzeTool`s without a live transport.

## Transport interception seam

```
McpClientHost
  └─ McpTransportFactory.create(admission) -> McpTransport (raw)
       └─ wrapped by RecordingTransport(observer)
            └─ on every tools/call request: emits ToolCallRecord
```

`ToolCallRecord` is the evidence-shaped record (serverId, method, params, response/error, timing). It is forwarded to the `onCall` callback the host receives in its constructor; that callback is where the agent loop hooks in evidence emission.

Cerbos gating is intentionally out of scope here — admission helpers (`validateAdmission`, `filterDiscoveredTools`) only enforce closed-list and sandbox-tier rules. Policy decisions happen in the agent loop after the discovered tools are surfaced as `FuzeTool`s.
