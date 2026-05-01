# @fuze-ai/agent-mcp-server

Exposes a `FuzeTool` set to external MCP hosts (Claude Desktop, Cursor, Cline) over JSON-RPC. Symmetric counterpart to `@fuze-ai/agent-mcp` (the host-side wrapper).

## Position

Distribution lever. Where `@fuze-ai/agent-mcp` lets a Fuze agent consume third-party MCP servers, this package lets external agents consume Fuze tools — same evidence pipeline, same Cerbos gate.

The MCP SDK is intentionally not a dependency. We hand-implement `tools/list` and `tools/call` over a `McpServerTransport` interface so operators can plug in stdio (default for Claude Desktop), HTTP, or any future transport without forking.

## Hard rules

1. **Special-category tools are refused by default.** A `dataClassification: 'special-category'` tool only appears in `tools/list` and is callable when `allowSpecialCategory: true` is set on the server. Same posture as the Cloud-tier refusal in the loop — explicit opt-in for Art. 9 data flowing across the MCP boundary.
2. **Every `tools/call` runs the policy gate.** Cerbos `deny`/engine-error returns a JSON-RPC error; no allow-on-error path.
3. **Every `tools/call` emits an evidence span** with role `tool` and span name `mcp.tools/call`, redacted via the same pre-export pipeline.
4. **Input/output Zod validation is non-skippable.** Bad input → JSON-RPC error.
