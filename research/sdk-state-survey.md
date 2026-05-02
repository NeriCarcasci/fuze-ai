# Fuze Agent SDK Implementation State Survey

## Package Status Table

| Package | Status | Files | Tests | Notes |
|---------|--------|-------|-------|-------|
| agent | REAL | 36 | 20 | Core loop + conformance, 1.5K LOC in loop/ |
| agent-tools | PARTIAL | 6 | 6 | Sandbox tool catalog + fake-sandbox test util |
| agent-mcp | PARTIAL | 9 | 5 | MCP host wrapper, policy gating, Cerbos integration |
| agent-providers | PARTIAL | 5 | 5 | Mistral, Scaleway, OVHcloud EU resident adapters |
| agent-memory | PARTIAL | 4 | 2 | Memory adapters with per-tenant isolation |
| agent-guardrails | PARTIAL | 4 | 3 | PII, prompt injection, residency guardrails |
| agent-redaction | PARTIAL | 6 | 5 | Pluggable PII engine (regex + Presidio sidecar) |
| agent-signing | STUB | 3 | 2 | Ed25519 adapters; KMS deferred to Phase 4 |
| agent-suspend-store | PARTIAL | 4 | 2 | SQLite store for HITL suspended runs |
| agent-durable | REAL | 5 | 2 | SQLite snapshot store, fully implemented run persistence |
| agent-eval | REAL | 12 | 11 | Dataset × Case × Evaluator runner + 8 evaluators + LLM-judge |
| agent-sandbox-justbash | PARTIAL | 5 | 4 | Wraps just-bash simulated bash |
| agent-sandbox-e2b | PARTIAL | 5 | 3 | Wraps E2B microVM sandbox |
| agent-policy-cerbos | PARTIAL | 9 | 5 | YAML+CEL evaluator; @cerbos/embedded WASM in Phase 2 |
| agent-annex-iv | REAL | 5 | 3 | Maps evidence to EU AI Act Annex IV + ISO 42001 |

## Key Implementation Findings

### Workflow/DAG/Graph Runtime
**No explicit DAG or graph runtime found.** The agent uses a step-based loop model:
- Loop in `loop.ts` (632 LOC) handles single-turn tool invocation + retry logic
- `resume.ts` (432 LOC) implements suspended-run continuation after HITL approval
- No multi-step composition, workflow orchestration, or DAG language
- Evidence chain uses hash-chaining (not DAG nodes), signed via Ed25519
- Runtime is linear-sequential with suspension/resumption via tokens

### Browser/Playwright/Puppeteer Tools
**No browser tool implementation.** Zero references to playwright, puppeteer, or headless Chrome.
- `agent-tools` provides sandbox-backed tool catalog
- Sandbox adapters (justbash, E2B) target code execution environments, not web browsing
- No web automation or DOM interaction capability exists

### Vector/Embedding/Retrieval Primitive
**No retrieval or vector store.** Only 2 passing mentions found:
- `agent-transparency/rekor-live.test.ts` uses Rekor (transparency log), not vector DB
- `daemon/audit-store.test.ts` tests audit trails, not semantic search
- Memory adapters support per-tenant isolation and subject erasure, but no vector embeddings
- No LLM embedding calls, no Qdrant/Pinecone/ChromaDB integration

### agent-durable Implementation
**REAL, production-ready durable snapshot store:**
- `snapshot-store.ts` implements `SqliteDurableRunStore` interface
- Persists `DurableRunSnapshot` at each step boundary via SQLite (upsert)
- Restores full agent state (history, completed tools, retry/step budget) on resume
- Supports GDPR-style erasure by `subjectHmac` and orphaned-run cleanup
- Integrates with agent loop via optional `snapshotSink` callback
- Not just an interface—fully functional, tested, integrated into main loop

### agent-eval Implementation
**REAL, comprehensive evaluation framework:**
- Dataset × Case evaluator pattern (Pydantic-AI inspired)
- Built-in evaluators: exact-match, schema-shape, PII-leak, evidence-contains, token-budget, latency, policy-decision, hash-chain-valid
- LLM-as-judge (`llm-judge.ts`) for semantic scoring
- `runEvaluation()` executes test cases, collects evidence, aggregates scores, reports pass-rate
- Full test suite (11 test files) covering all evaluator types
- Runnable end-to-end; not a stub
