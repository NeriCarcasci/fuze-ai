# Fuze Agent — Phase 1 / Phase 2 plan

This is the rolling spec for what's being built. Phase 0 is shipped (six primitives, owned loop, evidence pipeline, hash chain, fail-stop policy gate, 23 tests in this package, 88 across the agent ecosystem).

## Phase 1 — Real sandboxes + HITL + real policy

Goal: replace every stub with production-shaped code, ship the human-oversight primitive that makes Art. 14 evidence real, and add cryptographic signing of run-roots.

### Deliverables

| # | Package | Purpose |
|---|---|---|
| 1.1 | `@fuze-ai/agent-policy-cerbos` | Cerbos embedded WASM policy engine; YAML+CEL policies in `policies/` |
| 1.2 | `@fuze-ai/agent-sandbox-justbash` | `just-bash` adapter; logger + fetch hooks fan out to evidence |
| 1.3 | `@fuze-ai/agent-sandbox-e2b` | E2B managed sandbox; `pause/resume` for HITL |
| 1.4 | `@fuze-ai/agent` (additions) | Suspend/resume types, loop branch, replay-protected resume token |
| 1.5 | `@fuze-ai/agent-tools` | First-party tools: bash, fetch, read_file, write_file (sandbox-backed) |
| 1.6 | `@fuze-ai/agent-signing` | Ed25519 signer interface; LocalKeySigner adapter (KMS adapters Phase 4) |
| 1.7 | `@fuze-ai/agent-suspend-store` | SQLite-backed suspend store; erasure cascade on subjectRef |

### Sequencing

Sequential foundation (must land before parallel work):
1. Conformance suites in `@fuze-ai/agent` (`Sandbox`, `PolicyEngine`, `Signer`, `Memory`).
2. `@fuze-ai/agent-signing` interface + `LocalKeySigner`.
3. HITL primitive in `@fuze-ai/agent` (suspend/resume types + loop branch).
4. Bypass tests (every escape hatch in the security review fails closed).

Parallelizable:
- A: `@fuze-ai/agent-policy-cerbos` (1.1)
- B: `@fuze-ai/agent-sandbox-justbash` (1.2)
- C: `@fuze-ai/agent-sandbox-e2b` (1.3)
- D: `@fuze-ai/agent-tools` (1.5)
- E: `@fuze-ai/agent-suspend-store` (1.7)

## Phase 2 — MCP host + server + admission policy

| # | Package | Purpose |
|---|---|---|
| 2.1 | `@fuze-ai/agent-mcp` (replace stub) | Real `@modelcontextprotocol/sdk` Client + Transport interception |
| 2.2 | Cerbos policy `mcp.admission.yaml` | Server fingerprint allowlist, per-tool allowlist, sandbox-tier required |
| 2.3 | `@fuze-ai/agent-mcp-server` | Expose Fuze tools as MCP server (Claude Desktop / Cursor distribution) |
| 2.4 | `@fuze-ai/agent-mcp` (lazy expose) | Token budget on `tools/list`, soft warn at 80%, hard cap |
| 2.5 | Live MCP integration tests | Against `server-filesystem` and `server-git`, behind CI-only flag |

## Testing contract

Categories every component must satisfy:

| Category | What it covers | Pass criterion |
|---|---|---|
| Unit | Single function, no I/O | Per-file vitest |
| Type-invariant | Compile-time refusal | `// @ts-expect-error` proves bad shapes don't compile |
| Contract | Every adapter passes the same suite | `runConformanceTests(adapter)` shared per interface |
| Bypass | Every escape hatch in the security review fails | Named `bypass.*.test.ts` files |
| Property | Hash chain + canonicalization | `forall(records) verifyChain(emit(records)) === true` |
| Golden | Evidence bundle stability | JSON snapshot, hash-stable across versions |
| Integration | Cross-package | One per phase exit criterion |
| Live (skipped without keys) | Real provider/E2B/MCP | `describe.skipIf(!env.KEY)` |

CI gates:
- `tsc --noEmit` clean
- `vitest run` all green
- Golden bundles match
- Bypass suite all green
- `npm audit` no high/critical

### Bypass tests required for Phase 1

| File | Asserts |
|---|---|
| `bypass.tool-calls-tool.test.ts` | Tool that tries `deps.otherTool.run()` cannot — typecheck refuses |
| `bypass.guardrail-calls-model.test.ts` | Guardrail receives restricted handle |
| `bypass.dynamic-tool-no-metadata.test.ts` | `unverifiedTool()` without metadata throws (already exists) |
| `bypass.policy-engine-error.test.ts` | Cerbos throw → run halts (already exists) |
| `bypass.replay-attack.test.ts` | Reused `resumeToken` rejected |
| `bypass.in-process-multi-tenant.test.ts` | InProcessSandbox refuses second tenant (already exists) |
| `bypass.tampered-evidence.test.ts` | `verifyChain` returns false on byte flip |
| `bypass.secret-in-args.test.ts` | `SecretRef` in args never reaches evidence as plaintext |
| `bypass.lawful-basis-mismatch.test.ts` | Run with non-allowed basis refused (already exists) |

## Open decisions (closed for Phase 1 start)

1. Cerbos compile: checked-in `bundle.wasm` with CI verification.
2. Suspend store: SQLite for Phase 1; Postgres adapter Phase 4.
3. Local key file: `~/.fuze/agent-key`, `0600` perms (mirrors fuze-ai's audit key).
4. MCP server transport: stdio default; HTTP optional in Phase 2.
5. Live test infra: nightly CI only, skipped locally, secrets in GitHub Actions.

## Phase 0 invariants kept

These are already enforced; do not regress in Phase 1+:

- Discriminated `FuzeTool` union; compliance fields are type invariants
- Lawful-basis compatibility checked at run start
- `subjectRef` required for non-public data
- Annex III + Art. 14 oversight required for non-`none` domains
- Model residency vs. EU-only tools checked
- Cerbos fail-stop on engine error
- Hash chain non-bypassable (every span goes through `EvidenceEmitter`)
- Retry budget loop-only (providers `maxRetries: 0`)
- Tool-result guardrail phase between `execute_tool` and next model call
- `Ctx.invoke()` is the only sibling-tool path
