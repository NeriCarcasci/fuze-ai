# Fuze agent — implementation plan, 2026-05

## Strategic frame

Fuze sits on unclaimed ground: **EU-resident, hash-chained, signed agent runtime**. No incumbent owns this. Mastra wins DX, LangGraph wins durability, PydanticAI wins typed observability — but none of them ship signed evidence as a first-class artifact, and none of them structurally can without rebuilding their core. The strategic line is: **every new capability we add must emit signed evidence by default**. Build features that compound with the chain (workflows, attested browser, signed MCP, signed retrieval); skip features that dilute the brand (voice, stealth, crew theatre). Compliance is the moat; agent capabilities are the surface.

## Current state summary

The survey shows a real core (`agent`, `agent-durable`, `agent-eval`, `agent-annex-iv`) with a hash-chained span emitter, signed run-roots over Ed25519, durable snapshot store, and an evaluation framework. Most peripheral packages are PARTIAL — usable shells but incomplete catalogs. The five gaps that matter most for the target shape:

1. **No workflow runtime.** The loop is linear-sequential; there is no graph composition, no `parallel`, no declarative branching. This is the single largest missing primitive and the largest compliance amplifier.
2. **Tool catalog is half-finished.** `bash`, `fetch`, `readFile`, `writeFile`, `listFiles` exist; `grep`, `glob`, `edit`, and `webSearch` do not. After Claude Code, a catalog without these is incomplete.
3. **Provider matrix is EU-only.** Mistral/Scaleway/OVH ship; OpenAI and Anthropic adapters are absent. EU-default is correct positioning, but the framework cannot be sold as "provider-neutral" while the two largest providers are missing.
4. **No browser automation.** Zero references to Playwright. Browser sessions are the second-largest evidence amplifier after workflows ("we can prove what the agent saw").
5. **No retrieval primitive.** No vector store, no embeddings. Correctly deferred per the bash-vs-RAG thesis, but eventually opt-in vector retrieval is needed for prose corpora.

Signing is partial (Ed25519 only, no KMS), and there is no MCP server attestation despite `agent-mcp` being present.

## Target architecture (end state, ~2 quarters out)

Fuze ships a small TS-first SDK whose public surface is `defineAgent`, `defineTool`, `defineWorkflow`, `defineRetriever`, and a small set of run entry points. The agent loop, workflow runtime, and tool catalog all emit into a single hash-chained evidence stream signed at the run-root. The tool catalog matches Claude Agent SDK shape (bash/fetch/file/read/write/edit/grep/glob/webSearch) with each call captured as a span. Workflows are declarative graphs (step, parallel, branch, suspend, resume) where each node is a span and the whole DAG signs into one run-root via `agent-durable` for crash-recovery. Browser automation ships as a Playwright wrapper with hashed DOM/screenshot evidence. Vector retrieval is opt-in via `defineRetriever`, never the default. Provider adapters cover Mistral/Scaleway/OVH/Anthropic/OpenAI with type-level residency tags; non-EU models cannot bind to personal-data tools at compile time. Signing supports KMS (AWS, GCP) for enterprise, and MCP server connections are pinned by hash and attested per-run. The through-line: **every capability emits signed evidence**.

---

## Milestones

### M1 — Tool catalog completion

**Goal.** Bring `agent-tools` to parity with Claude Agent SDK so the tool catalog is no longer a competitive gap.

**Scope.**
- Add `grepTool` (regex over a path, ripgrep-backed inside the sandbox).
- Add `globTool` (glob expansion against the sandbox FS).
- Add `editTool` (path + old_string + new_string semantics, atomic file replace).
- Add `webSearchTool` with provider-pluggable backend (Brave, Tavily, SerpAPI as adapters).
- Streaming results for `bash` stdout (already returns `stdout` whole; add a `bashStream` variant emitting incremental `tool.partial` spans gated by retention).
- Wire all new tools into the existing replay-protected approval flow (`evaluateApproval` + `executeApprovedTool`).

**Out of scope.** Code-as-action (smolagents-style script tool), MCP exposure of these tools, language-server integration. All deferred.

**New files.**
- `packages/agent-tools/src/grep.ts`
- `packages/agent-tools/src/glob.ts`
- `packages/agent-tools/src/edit.ts`
- `packages/agent-tools/src/web-search.ts`
- `packages/agent-tools/src/web-search/providers/brave.ts`
- `packages/agent-tools/src/web-search/providers/tavily.ts`
- `packages/agent-tools/src/web-search/types.ts`
- `packages/agent-tools/src/bash-stream.ts`
- Tests next to each.

**Existing packages touched.** `agent-tools` (re-exports in `index.ts`), `agent` (no changes — approval flow already supports new tool names), `agent-policy-cerbos` (add default policies for new tools).

**Public API additions.**

```ts
export const grepTool = (deps: GrepToolDeps): PublicTool<GrepIn, GrepOut, unknown>
const grepInput = z.object({
  pattern: z.string().min(1),
  path: z.string().min(1),
  glob: z.string().optional(),
  caseInsensitive: z.boolean().default(false),
  maxMatches: z.number().int().positive().max(10_000).default(1000),
})
const grepOutput = z.object({
  matches: z.array(z.object({
    path: z.string(),
    line: z.number().int().positive(),
    text: z.string(),
  })),
  truncated: z.boolean(),
  durationMs: z.number().int().nonnegative(),
})

export const editTool = (deps: EditToolDeps): PublicTool<EditIn, EditOut, unknown>
const editInput = z.object({
  path: z.string().min(1),
  oldString: z.string(),
  newString: z.string(),
  expectedOccurrences: z.number().int().positive().default(1),
})
const editOutput = z.object({
  path: z.string(),
  occurrencesReplaced: z.number().int().nonnegative(),
  bytesWritten: z.number().int().nonnegative(),
})
```

`webSearchTool` accepts `provider: WebSearchProvider` where `WebSearchProvider` is `{ search(query, opts) -> Promise<SearchHit[]> }`.

**Evidence/spans emitted.** `tool.grep`, `tool.glob`, `tool.edit`, `tool.web-search`, `tool.bash.partial` (streaming chunks). All inherit the existing `SpanCommonAttrs` shape, retention-gated for content, hash-only for redacted.

**Test plan.**
- Unit: each tool against `fake-sandbox`, schema round-trip, threat-boundary assertions.
- Integration: a workflow that does `grep` -> `edit` -> verify chain signs.
- Conformance: extend the existing tool-conformance suite with grep/glob/edit/web-search expected-span shapes.
- Done = full vitest pass plus chain verification of integration runs.

**Acceptance criteria.**
- `agent-tools` exports `grepTool`, `globTool`, `editTool`, `webSearchTool`.
- Each tool returns `Ok(...)` on happy path and structured `Retry`/`Refused` on failure.
- Each tool emits a span that passes `verifyChain`.
- `editTool` is atomic — partial writes never observable.
- `webSearchTool` rejects connection unless an explicit provider is wired (no default keys leak).

**Risks.**
- *Ripgrep binary not in all sandboxes.* Mitigation: ship a pure-Node fallback (slower, used only when `which rg` fails).
- *Edit-tool ambiguity on `expectedOccurrences=1` with multiple matches.* Mitigation: refuse and return a `Refused` outcome rather than arbitrary first-match.
- *Web-search provider keys leaking into spans.* Mitigation: route keys through the existing secrets indirection; never include in input span.

**Estimate.** M (1 quarter, one engineer).

**Depends on.** None. Can start immediately.

---

### M2 — Provider expansion + EU residency types

**Goal.** Add OpenAI and Anthropic adapters while encoding residency at the type level so the EU-first stance survives the larger surface.

**Scope.**
- `OpenAIProvider` and `AnthropicProvider` adapters in `agent-providers`.
- Residency typing: `residency: 'us' | 'eu' | 'multi'` as a discriminator on the provider type.
- Compile-time refusal: a tool tagged `personalData` or `specialCategory` cannot bind to a non-EU model.
- Defaults remain EU (Mistral) in `quickstart` and any starter recipes.
- Update `defineAgent` to accept the residency-typed provider and surface a span attribute `provider.residency` per call.

**Out of scope.** Per-region routing inside a single provider (e.g., AWS Bedrock EU vs. US), provider-specific tool-schema translation beyond what AI SDK already does, fine-tuning APIs.

**New files.**
- `packages/agent-providers/src/openai.ts`
- `packages/agent-providers/src/anthropic.ts`
- `packages/agent-providers/src/residency.ts`

**Existing packages touched.** `agent-providers` (re-exports, types), `agent` (`define-agent.ts` accepts `residency`-tagged provider; loop emits residency on `model.invoke` spans), `agent-guardrails` (residency guardrail consults the provider tag rather than a separate config).

**Public API additions.**

```ts
export type Residency = 'eu' | 'us' | 'multi'

export interface ModelProvider<R extends Residency = Residency> {
  readonly name: string
  readonly residency: R
  invoke(req: ProviderRequest): Promise<ProviderResponse>
}

export interface ToolDataClass {
  readonly personalData?: boolean
  readonly specialCategory?: boolean
}

type CompatibleProvider<T extends ToolDataClass> =
  T['specialCategory'] extends true ? ModelProvider<'eu'>
  : T['personalData'] extends true ? ModelProvider<'eu'>
  : ModelProvider<Residency>

export const openAI = (opts: OpenAIOpts): ModelProvider<'us'>
export const anthropic = (opts: AnthropicOpts): ModelProvider<'us' | 'eu'>
```

**Evidence/spans emitted.** Existing `model.invoke` span gains required attrs `provider.name`, `provider.residency`, `provider.region` (when known).

**Test plan.**
- Unit: each adapter against a recorded fixture HTTP layer.
- Type tests: `expectError` (tsd) on binding a `specialCategory: true` tool to a `'us'` provider.
- Integration: a quickstart agent runs against each provider with the same tools.
- Done = type tests pass + integration parity across providers.

**Acceptance criteria.**
- A `personalData: true` tool bound to a `'us'` provider fails `tsc`.
- All `model.invoke` spans carry residency, validated by `verifyChain` extension.
- Quickstart still defaults to Mistral.
- `anthropic()` constructor accepts an explicit `region: 'us' | 'eu'` and types its return accordingly.

**Risks.**
- *Provider tool-call schema drift.* Mitigation: lean on Vercel AI SDK as the translation layer; pin its version.
- *`'multi'` residency erodes the type guarantee.* Mitigation: `'multi'` is an explicit, audited escape hatch; the tool tag drives `'eu'` requirement and `'multi'` does not satisfy it.
- *Residency claims unverifiable at runtime.* Mitigation: accompany the type-level tag with a span attribute that compliance can audit, plus documentation that the tag is *operator-asserted*, not provider-attested.

**Estimate.** M (3 weeks, one engineer).

**Depends on.** None. Can run in parallel with M1.

---

### M3 — Workflow runtime (the big one)

**Goal.** Ship `defineWorkflow` — declarative graph-shaped workflows that integrate with the existing run-root signing and durable snapshot store.

**Scope.**
- New package `packages/agent-workflow`.
- Primitives: `step`, `parallel`, `branch`, `suspend`, `resume`.
- Each step is a first-class span; the workflow execution chains into the existing run-root.
- Crash-recovery via `agent-durable` (snapshot at every step boundary).
- Steps may invoke agents (`step.agent(...)`), invoke tools directly (`step.tool(...)`), or run a typed callback (`step.run(async (ctx) => ...)`).
- `branch` is condition-typed: returns one of N labelled branches.
- `parallel` runs N steps; each emits its own span; the parent emits a `workflow.parallel.join` span that lists child span hashes.
- `suspend` mints a resume token (reuse `mintResumeToken` from `agent`); `resume` consumes it and continues from the persisted snapshot.

**Out of scope.** Cross-workflow composition (workflows calling other workflows by reference) — deferred to a later milestone. Visualization rendering — that's the dashboard's problem. A no-code editor.

**New files.**
- `packages/agent-workflow/package.json`
- `packages/agent-workflow/src/index.ts`
- `packages/agent-workflow/src/define.ts` (`defineWorkflow`, primitive constructors)
- `packages/agent-workflow/src/runtime.ts` (executor, scheduler)
- `packages/agent-workflow/src/dag.ts` (graph type, validation, cycle detection)
- `packages/agent-workflow/src/spans.ts` (workflow span shapes + hash-chain integration)
- `packages/agent-workflow/src/parallel.ts`
- `packages/agent-workflow/src/branch.ts`
- `packages/agent-workflow/src/suspend.ts`
- Tests for each.

**Existing packages touched.** `agent` (the loop becomes one possible step kind; nothing renamed), `agent-durable` (extend snapshot schema with `workflowState`), `agent-suspend-store` (workflows reuse the existing suspended-run table; add `workflowId` column), `agent-eval` (add `workflow` evaluator type).

**Public API additions.**

```ts
export const defineWorkflow = <Input, Output>(spec: WorkflowSpec<Input, Output>) => Workflow<Input, Output>

export interface WorkflowSpec<I, O> {
  readonly name: string
  readonly version: string
  readonly input: z.ZodType<I>
  readonly output: z.ZodType<O>
  readonly graph: (b: WorkflowBuilder) => WorkflowNode<O>
}

export interface WorkflowBuilder {
  step<S>(name: string, fn: (ctx: StepCtx) => Promise<S>): WorkflowNode<S>
  agent<S>(name: string, agent: Agent, input: AgentInput): WorkflowNode<S>
  tool<S>(name: string, tool: PublicTool<any, S, any>, input: any): WorkflowNode<S>
  parallel<T extends readonly WorkflowNode<unknown>[]>(...nodes: T): WorkflowNode<NodeOutputs<T>>
  branch<S>(name: string, cond: (ctx) => string, branches: Record<string, WorkflowNode<S>>): WorkflowNode<S>
  suspend<S>(name: string, reason: string): WorkflowNode<S>
}

export const runWorkflow = <I, O>(wf: Workflow<I, O>, input: I, deps: WorkflowDeps): Promise<WorkflowResult<O>>
```

**Evidence/spans emitted.**
- `workflow.start` (workflow name+version, input hash, graph fingerprint).
- `workflow.step.start` / `workflow.step.end` (step name, input hash, output hash, durationMs).
- `workflow.parallel.fork` / `workflow.parallel.join` (fork lists child node ids; join lists child span hashes — see self-review).
- `workflow.branch.taken` (condition value, taken branch label).
- `workflow.suspend` (resume token id, reason).
- `workflow.resume` (token consumed).
- `workflow.end` (output hash, total durationMs, run-root hash).

**Test plan.**
- Unit: graph validation (cycles, dead branches, unreachable nodes).
- Unit: each primitive in isolation.
- Integration: a 5-step workflow with a `parallel` of two and a `branch` of three; verify chain signs end-to-end.
- Crash-recovery: kill the runtime mid-workflow, restart from snapshot, verify completion span hash matches what would have been generated continuously (modulo timestamps).
- Conformance: `verifyChain` over a workflow run + parallel branches.
- Done = all of the above plus an `agent-eval` evaluator that asserts a workflow's signed run-root.

**Acceptance criteria.**
- `defineWorkflow` rejects cyclic graphs at definition time.
- A 100-step workflow snapshots at each boundary and resumes cleanly after a hard kill.
- Run-root over a workflow run matches across two independent re-executions of the same input (modulo non-determinism flagged in spans).
- `parallel` of N nodes produces N independent chained spans plus a join span with their hashes.
- `suspend`/`resume` integrates with the existing replay-protected approval primitive without modification.

**Risks.**
- *Hash-chain becomes a tree under `parallel`.* Mitigation: see self-review item 1; recommended approach is per-branch sub-chains joined into the parent chain at `join` (chain-of-chains, not a tree). Decide before coding.
- *Workflow definition drift between TS source and persisted snapshot.* Mitigation: extend `computeDefinitionFingerprint` to cover the workflow graph; mismatch raises `DefinitionFingerprintMismatchError` on resume.
- *Scope creep into a no-code editor.* Mitigation: non-goal stated; dashboard owns rendering.

**Estimate.** L (2–3 quarters, one engineer; faster with two).

**Depends on.** M1 (tools must exist for `step.tool`), M2 (provider residency must be in place for `step.agent` to honor compliance tags). Can start design and graph type-work immediately; runtime work blocks on those.

---

### M4 — Browser automation, attested

**Goal.** Ship `agent-browser` — a Playwright wrapper where every interaction is a span and DOM snapshots/screenshots are captured into the evidence chain.

**Scope.**
- New package `packages/agent-browser`.
- Tools: `browser.navigate`, `browser.click`, `browser.fill`, `browser.read` (text+a11y tree), `browser.screenshot`, `browser.snapshot` (DOM + a11y tree).
- DOM/accessibility-tree-first interactions (no vision, no pixel coordinates).
- Screenshots: `sha256` of the PNG goes into the span; full bytes go to a content-addressed store gated by retention policy.
- DOM snapshots: same shape (hash in span, content optional).
- Sandboxed via existing `SandboxTier` abstraction; Playwright runs inside the sandbox tier the operator selected.
- No stealth, no anti-detection, no captcha bypass.

**Out of scope.** Vision-driven action, recording-and-replay UI, browser fingerprint randomization, mobile emulation as a first-class profile (default desktop only).

**New files.**
- `packages/agent-browser/package.json`
- `packages/agent-browser/src/index.ts`
- `packages/agent-browser/src/session.ts` (browser context lifecycle)
- `packages/agent-browser/src/navigate.ts`, `click.ts`, `fill.ts`, `read.ts`, `screenshot.ts`, `snapshot.ts`
- `packages/agent-browser/src/evidence.ts` (hash-and-store for blobs)
- `packages/agent-browser/src/a11y.ts` (a11y-tree extraction)

**Existing packages touched.** `agent-tools` (browser tools follow the same `defineTool.public` shape; nothing to change there), `agent` (no changes), `agent-policy-cerbos` (default policies for browser actions, especially form-submit and click-on-payment-element).

**Public API additions.**

```ts
export const browserSession = (deps: BrowserDeps): BrowserSession
export const browserNavigateTool = (deps: BrowserToolDeps): PublicTool<NavigateIn, NavigateOut, unknown>
export const browserClickTool = (deps: BrowserToolDeps): PublicTool<ClickIn, ClickOut, unknown>
// ... fill, read, screenshot, snapshot

const screenshotOutput = z.object({
  hash: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  capturedAt: z.string().datetime(),
  storedAt: z.string().optional(),
})
```

**Evidence/spans emitted.** `browser.navigate`, `browser.click` (target selector + a11y description), `browser.fill` (field selector + value-hash), `browser.read`, `browser.screenshot` (PNG hash), `browser.snapshot` (DOM hash + a11y-tree hash).

**Test plan.**
- Unit: each tool against a fixture HTML page served from a local Playwright test server.
- Integration: a 5-step browser workflow (navigate, fill form, screenshot, click submit, screenshot) with chain verification.
- Replay: rerun a recorded session against the same fixture page; assert DOM-hash equality.
- Done = all of the above plus a documented retention story for screenshots.

**Acceptance criteria.**
- Every browser tool emits a span with a content-addressed hash.
- Screenshot bytes never appear inline in spans (always hashed and externalized).
- A run that touches a payment-element selector triggers approval via the existing replay-protected approval flow.
- Tools refuse if the session was opened outside a sandbox tier.

**Risks.**
- *Playwright binary distribution is fat (~300MB).* Mitigation: keep `agent-browser` an optional install (not in the default quickstart).
- *DOM-hash determinism — modern apps mutate the DOM constantly.* Mitigation: hash the *post-settle* DOM (Playwright `waitForLoadState('networkidle')` + a deterministic stripper that removes obvious nondeterministic attrs like data-reactid clones); document the limit.
- *A11y-tree extraction varies across browsers.* Mitigation: standardize on Chromium for v1; Firefox/WebKit later.

**Estimate.** M (1.5 quarters).

**Depends on.** M1 (tool catalog idioms must be settled). Can run in parallel with M3.

---

### M5 — Vector retrieval, opt-in

**Goal.** Ship `agent-retrieval` — `defineRetriever` with pgvector default, every query a span. Explicitly not a default retrieval path.

**Scope.**
- New package `packages/agent-retrieval`.
- `defineRetriever` accepting a backend adapter and an embedding-model adapter.
- pgvector backend as the default (others pluggable).
- Contextual embeddings pipeline (Anthropic-style): chunk, contextualize-via-LLM, embed, store.
- Retriever exposed to the agent as a tool (`retrieverTool(retriever)` -> `PublicTool`).
- Each query emits a span with: query text (retention-gated), chunk IDs, similarity scores, embedding-model name+version, backend name+version.

**Out of scope.** Reranking, hybrid retrieval (BM25 + vector), graph retrieval. All deferred.

**New files.**
- `packages/agent-retrieval/package.json`
- `packages/agent-retrieval/src/index.ts`
- `packages/agent-retrieval/src/define.ts`
- `packages/agent-retrieval/src/backends/pgvector.ts`
- `packages/agent-retrieval/src/backends/types.ts`
- `packages/agent-retrieval/src/embedding/types.ts`
- `packages/agent-retrieval/src/embedding/openai.ts`
- `packages/agent-retrieval/src/embedding/mistral.ts`
- `packages/agent-retrieval/src/contextual.ts` (chunking + contextualization)
- `packages/agent-retrieval/src/tool.ts` (tool wrapper)

**Existing packages touched.** `agent-tools` (re-export `retrieverTool`), `agent-providers` (embedding providers gain residency tags too).

**Public API additions.**

```ts
export const defineRetriever = <Doc>(spec: RetrieverSpec<Doc>): Retriever<Doc>

export interface RetrieverSpec<Doc> {
  readonly name: string
  readonly backend: VectorBackend
  readonly embedding: EmbeddingProvider
  readonly contextualize?: (chunk: Chunk, doc: Doc) => Promise<string>
  readonly chunker?: Chunker
}

export interface Retriever<Doc> {
  ingest(docs: readonly Doc[]): Promise<IngestResult>
  query(text: string, opts?: QueryOpts): Promise<QueryResult>
  erase(filter: EraseFilter): Promise<void>
}

export const retrieverTool = <Doc>(r: Retriever<Doc>, deps: RetrieverToolDeps): PublicTool<RetrieveIn, RetrieveOut, unknown>
```

**Evidence/spans emitted.** `retrieval.query` (queryHash, chunkIds, scores, embeddingModel, backend), `retrieval.ingest` (docCount, chunkCount, embeddingModel — emitted only if ingest happens during a run), `retrieval.erase` (subjectHmac, deletedChunkCount).

**Test plan.**
- Unit: each backend against a Docker-compose pgvector instance (or testcontainers).
- Unit: contextualization round-trip with a recorded LLM fixture.
- Integration: ingest 100 docs, query, assert top-K shape and span chain.
- Erasure: ingest, erase by subjectHmac, assert query returns no chunks for that subject.
- Done = above plus an example showing retriever-as-tool inside a workflow.

**Acceptance criteria.**
- Retriever is *never* called by the loop unless explicitly bound as a tool.
- Every query emits a span that captures `embeddingModel` and `backend.version`.
- Erasure by `subjectHmac` removes both the chunk row and its vector.
- pgvector is one option among many; the package does not import pg unconditionally.

**Risks.**
- *Fuze has no documented DB infra story.* Mitigation: see self-review item 2 — pgvector is a *default backend*, not a Fuze-managed service. Document the operator's responsibility to bring a Postgres.
- *Embedding-model deprecation breaks old indexes.* Mitigation: model+version on every chunk row; query refuses if the embedding model version differs from the index unless `allowMismatch: true`.
- *Contextualization cost.* Mitigation: it's optional — the contextualizer is a hook, not a default.

**Estimate.** M (1 quarter).

**Depends on.** M1 (tool shape), M2 (embedding providers reuse residency types).

---

### M6 — KMS signing + signed MCP server attestation

**Goal.** Finish `agent-signing` with KMS adapters, and ship pinned-hash attestation for MCP servers.

**Scope.**
- AWS KMS adapter (sign via KMS, public key cached).
- GCP KMS adapter (same shape).
- `agent-mcp` gains a pinned-hash registry: each connection asserts `expectedHash`; the connecting machinery hashes the announced server descriptor and compares.
- Span emitted on every MCP connection (`mcp.connect`) with announced hash, expected hash, and match outcome.
- Run refuses to start if any MCP server in the manifest fails attestation.

**Out of scope.** A registry service (centralized list of allowed MCP servers). HSM adapters beyond AWS/GCP. Hardware key attestation (TPM, YubiKey).

**New files.**
- `packages/agent-signing/src/aws-kms.ts`
- `packages/agent-signing/src/gcp-kms.ts`
- `packages/agent-mcp/src/attestation.ts`
- `packages/agent-mcp/src/pinned-hash.ts`

**Existing packages touched.** `agent-signing` (re-exports), `agent-mcp` (host wrapper consults attestation before exposing tools).

**Public API additions.**

```ts
export const awsKmsSigner = (opts: { keyId: string, region: string }): Signer
export const gcpKmsSigner = (opts: { keyName: string }): Signer

export interface McpServerPin {
  readonly name: string
  readonly expectedHash: string  // sha256 of canonical descriptor
  readonly url: string
}

export const pinnedMcpRegistry = (pins: readonly McpServerPin[]): McpRegistry
```

**Evidence/spans emitted.** `mcp.connect` (server name, announcedHash, expectedHash, match: bool, durationMs), `signing.run-root` (existing) gains attribute `signer.kind = 'ed25519' | 'aws-kms' | 'gcp-kms'`.

**Test plan.**
- Unit: KMS adapters against `aws-sdk-client-mock` / GCP test doubles.
- Unit: attestation against a fixture MCP server with known descriptor.
- Integration: a run where one MCP server fails attestation refuses to start with a verifiable evidence trail.
- Done = above.

**Acceptance criteria.**
- Run-root signature verifies under both Ed25519 (existing) and KMS adapters.
- A run cannot start with an unpinned MCP server unless `mcpAttestation: 'permissive'` is explicitly set.
- `mcp.connect` spans chain into the run-root and verify under all signers.

**Risks.**
- *KMS latency on hot loop.* Mitigation: KMS signs the run-root only, not every span; spans use a session key signed by KMS once per run.
- *Pinned-hash brittleness on legitimate MCP server updates.* Mitigation: pins are a *list* per server name, not a single value; document a rotation procedure.

**Estimate.** M (3–4 weeks).

**Depends on.** None functionally; runs in parallel.

---

## Cross-cutting concerns

**Evidence/span schema versioning.** Today `verifyChain` accepts whatever shape spans take. As new span types land (workflow.*, browser.*, retrieval.*, mcp.connect), the chain must remain verifiable across SDK versions. Concrete proposal: add a top-level `spanSchemaVersion: number` to every emitted span; `verifyChain` accepts a registered schema-version range; new optional attributes are additive only; renames go through a one-version deprecation. The Annex IV mapper (`agent-annex-iv`) consumes spans and must enumerate which schema versions it understands.

**Test harness.** The conformance suite in `agent` is the right home for cross-package contract tests. Each new package ships its own test files plus a contribution to a top-level `conformance/` directory that runs end-to-end scenarios touching workflow + tools + browser + retrieval. A CI matrix runs the conformance suite against each provider adapter to catch schema drift.

**Documentation.** Every milestone ships with: an API reference (typedoc), one tutorial ("Build a workflow that…"), one how-to ("Add a vector retriever to an existing agent"). Docs live in `packages/<pkg>/docs/` and a top-level `docs/` aggregator publishes them.

**Backwards compatibility.** Phase commitment: the public surface in `packages/agent/src/index.ts` (today: `runAgent`, `defineAgent`, `defineTool`, evidence types, sandbox types, suspend primitives) is stable across this plan. New milestones extend, never break. The `EvidenceSpan` shape is append-only on optional fields. `verifyChain` continues to verify spans emitted by older SDKs (forward-only compatibility).

## Sequencing & critical path

M1 and M2 are independent and can run fully in parallel — different files, different concerns. They are also prerequisites for M3 in different ways: M3 needs the tool catalog to be stable (M1) and the provider residency types to exist (M2) before its `step.tool` and `step.agent` primitives type-check correctly. M3 is the longest milestone and the critical path; everything else can in principle slip without affecting it. M4 (browser) depends only on M1's tool idioms and can run in parallel with M3 from week 4 onward. M5 (retrieval) depends on M1 and M2 but not M3; it is small enough to be slotted whenever a second engineer is available. M6 (KMS + MCP attestation) is fully independent and can be picked up at any point.

Order-of-magnitude calendar in engineer-quarters (one solid engineer per stream):
- Stream A (one engineer): M1 (Q1) → M3 (Q2-Q3) → M5 (Q3-Q4).
- Stream B (one engineer): M2 (Q1, ~3 weeks) → M4 (Q1-Q2) → M6 (Q2).

Two engineers cover the whole plan in roughly 4 quarters; one engineer needs ~6 quarters and should drop M5 from the first cycle.

## Self-review — gaps and errors

1. **M3 hash-chain semantics under `parallel` are unspecified.** The current evidence chain is a linear hash-chain (`HashChain`, `verifyChain`). A workflow with `parallel` produces structurally a tree of spans. Three possible designs: (a) serialize the parallel branches into the linear chain at fork time (simple, loses parallelism in the evidence record), (b) per-branch sub-chains that join into the parent at the `join` span via a Merkle-style commitment (correct, requires extending `verifyChain`), (c) treat each branch as an independent run-root and sign their union at the workflow root (clean, but breaks the "one run = one root" mental model). Recommendation: (b). This needs a written ADR before M3 starts; the milestone description hand-waves it.
2. **M5 assumes pgvector availability but Fuze has no documented database story.** The `agent-durable` package uses SQLite for snapshots; there is no Postgres in the system. M5 introduces a Postgres dependency (or operator-supplied Postgres) without addressing where it fits in the deployment story. Either pgvector becomes a *recommended* backend with a SQLite-based default (sqlite-vss?), or the deployment docs need an explicit "you bring Postgres" section. Currently silent.
3. **Provider tool-call schema differences are glossed over in M2.** OpenAI uses one tool-call schema, Anthropic another, Mistral something close to OpenAI. The plan says "lean on Vercel AI SDK." That defers the question rather than answering it. Concretely: parallel tool calls, structured-output mode, and forced-tool semantics differ across providers and Vercel AI SDK papers over some but not all. The milestone should enumerate which of these we support uniformly and which we expose only when the provider supports them.
4. **M4 browser screenshot retention is underspecified.** The plan says "hash in span, content gated by retention." But retention policies today are about *how long* to keep things, not *whether* to keep them at all. A 1080p screenshot is ~500KB; a long browser session produces tens of MB of evidence. Where does it go? S3-compatible blob store? Local disk? Operator's responsibility? This needs the same treatment as M5's database story.
5. **M3 workflow definition fingerprinting is tossed off.** `computeDefinitionFingerprint` exists for agent definitions; extending it to workflows is one bullet in the risks section. A workflow graph has structure (nodes, edges) plus the fingerprints of every step's underlying agent or tool. The recursive fingerprint is non-trivial: changing a tool deep in the graph should invalidate the workflow fingerprint. The cost of getting this wrong is "snapshot resumes against a code version that has since diverged" — silent correctness bugs. It deserves its own ADR, not a risk bullet.

## Open questions for the team

1. **Hash-chain shape under parallel** — chain-of-chains with Merkle join, serialized linearization, or independent sub-roots? Blocks M3.
2. **Database deployment story** — does Fuze ship a recommended Postgres setup, or is bringing-your-own-pg an operator's problem? Affects M5 docs and M3 (workflow durability already uses SQLite — does workflow scale demand Postgres?).
3. **Dashboard ownership of workflow visualization** — the SDK can ship a CLI that renders a workflow graph as ASCII or a Graphviz DOT file. The dashboard repo can render it interactively. Both? One? Affects M3 docs scope.
4. **Python bindings parity for new surface** — the AGENTS.md hard rule says JS and Python are siblings, not forks. Does this plan ship Python bindings for `defineWorkflow`, `defineRetriever`, `agent-browser` in lockstep, or in a follow-up plan? If lockstep, every milestone roughly doubles in scope and the calendar shifts.
5. **M4 browser screenshot store backend** — local disk path? S3-compatible? A Fuze-managed blob store? This is a concrete operator-facing decision and the API depends on it.
