# Fuze agent feature research — 2026-05

*Author: research pass for the Fuze agent product page. All framework claims verified against current docs as of May 2026 unless flagged otherwise. Strategic frame: EU-first, compliance evidence as moat, TypeScript primary, Python secondary.*

## TL;DR

- **Ship a graph-shaped, signed workflow runtime first.** Mastra/LangGraph have made declarative DAGs the table-stakes shape for agent orchestration in 2026. Fuze's compliance moat (hash-chained spans, signed run-roots) compounds with this primitive in a way no competitor can match: a *signed* workflow execution is structurally a different artifact than what Mastra ships. Build the durable, suspendable workflow runtime, and let every step be a span in the existing audit chain.
- **Go all-in on agentic search (bash+grep+filesystem) for code/structured corpora; ship a small, opt-in vector retrieval primitive only for unstructured prose.** The Anthropic / Vercel / Augment / Cursor consensus has converged: for grep-able corpora, tools-over-RAG wins on accuracy, transparency, and audit-friendliness. Embeddings now belong as a *tool the agent calls*, not as the default retrieval path. This aligns perfectly with evidence-first compliance — every grep call is a span; every embedding query is a span.
- **Skip voice, skip stealth browser, deprioritize "multi-agent crew" theatre.** Voice is a non-compliance product surface; stealth tooling actively conflicts with EU-trust brand; "agent teams with backstories" (CrewAI-style) is mostly demoware. The features that do compound with evidence are: signed workflows, attested browser sessions (Playwright + accessibility tree, hash-chained), code-execution sandboxes with replay, and typed tool ergonomics.

The single biggest strategic recommendation: **rename "compliance evidence" externally as "agent execution receipts"** and make every capability below ship with the receipt by default. Compliance is the brand; the agent capabilities are the surface. Don't underplay either.

---

## 1. Competitive matrix

Legend: ✓ first-class, ◐ partial / via integration, ✗ not present, ? unverified

| Feature | Mastra | LangGraph | Vercel AI SDK | OpenAI Agents SDK | Claude Agent SDK | CrewAI | PydanticAI | Smolagents |
|---|---|---|---|---|---|---|---|---|
| Workflows / DAGs | ✓ graph state machine | ✓ graph-native (the moat) | ◐ ToolLoopAgent only | ◐ handoffs | ✗ loop-based | ✓ Flows (event-driven) | ◐ via Temporal/DBOS | ✗ |
| Tool ergonomics | ✓ Zod schemas, typed | ◐ Python-typed, verbose | ✓ Zod, clean DX | ✓ decorator | ✓ MCP-native | ◐ class-based | ✓ Pydantic-typed | ✓ "code as tool call" |
| Built-in tools (bash/fetch/file/web) | ◐ via integrations | ✗ BYO | ◐ via providers | ◐ web/file/code-interp | ✓ bash, file, edit native | ◐ tool zoo | ◐ web/think | ✓ code-first |
| RAG / vector | ✓ built-in | ◐ via LangChain | ◐ providers | ◐ via vector store tools | ✗ (deliberate) | ✓ built-in | ◐ via tools | ✗ |
| Memory (semantic / working) | ✓ first-class | ◐ checkpointer (state, not memory) | ◐ basic | ✓ sessions | ◐ CLAUDE.md + skills | ✓ shared/long-term | ◐ basic | ✗ |
| Browser automation | ◐ Playwright via tool | ◐ via tool | ◐ via tool | ◐ via tool | ✓ Playwright plugin first-class | ◐ via tool | ◐ via tool | ◐ via tool |
| Voice / multimodal | ✓ unified TTS/STT/STS | ✗ | ◐ via providers | ✓ realtime voice | ✗ | ✗ | ✗ | ✗ |
| Evals (offline + in-prod) | ✓ scorers + Studio | ◐ via LangSmith | ◐ via DevTools | ◐ via tracing | ◐ via promptfoo etc. | ◐ via Enterprise | ✓ via Logfire | ✗ |
| Deployment (durable / serverless) | ✓ Mastra Cloud | ✓ LangGraph Platform | ✓ Vercel-native | ◐ via Temporal | ◐ runtime-agnostic | ◐ Enterprise | ✓ Temporal/DBOS | ✗ |
| Multi-agent / handoffs | ✓ coordinator + workers | ✓ multi-agent graphs | ◐ basic | ✓ handoffs first-class | ✓ subagents | ✓ crews (the brand) | ◐ via composition | ◐ |
| Streaming UX | ✓ typed events | ✓ tokens+state+tool | ✓ best-in-class for React | ✓ realtime | ✓ tokens+tools | ◐ | ✓ structured stream | ◐ |
| MCP support | ✓ | ✓ | ✓ AI SDK 6 full | ✓ | ✓ native | ✓ | ✓ FastMCP | ✓ |
| Observability / tracing | ✓ + Studio UI | ✓ LangSmith (deepest) | ◐ DevTools | ✓ built-in | ◐ via OTEL | ◐ Enterprise | ✓ Logfire (best in class) | ✗ |
| Type safety | ✓ TS-first | ◐ Python types | ✓ TS-first | ◐ both | ✓ TS-first | ✗ Python loose | ✓ Pydantic-strict | ✗ |
| Provider neutrality | ✓ via AI SDK | ✓ | ✓ | ◐ OpenAI-leaning | ✗ Anthropic-only | ✓ | ✓ ~30 providers | ✓ |

Summary read of the matrix: **no incumbent owns "signed, replayable, EU-resident agent runtime"** — that is unclaimed ground. Mastra is the closest thing to Fuze's preferred shape (TS-first, workflows, evals built in) and is the right benchmark for DX. LangGraph is the most production-proven but too verbose for the TS market Fuze is targeting. PydanticAI is the only competitor that takes type safety + observability seriously as a *combined* story, and Logfire is the bar to beat for tracing aesthetics.

---

## 2. Framework deep-dives

### Mastra (mastra.ai) — DX 5/5, the benchmark

TypeScript-first, built by ex-Gatsby team, hit 1.0 in January 2026 with 22k+ stars and 300k weekly npm downloads ([mastra GitHub](https://github.com/mastra-ai/mastra), [Mastra "Choosing a JS Agent Framework"](https://mastra.ai/blog/choosing-a-js-agent-framework)). The shape is: agents + workflows + memory + evals + observability bundled into one framework, with Studio (a local UI) for running, recording, and replaying. Workflows are graph state machines where any step can `suspend`, hand to a human, and `resume`; you can time-travel back to any step with original context ([Mastra docs — Get started](https://mastra.ai/docs)).

**Strengths:** Cleanest TS DX in the field. Zod-typed tools. Delegates LLM calls to Vercel AI SDK so it inherits streaming maturity. Studio is genuinely useful for development. Agent setup is roughly 18h vs 41h for LangChain on equivalent tasks per third-party benchmark ([Speakeasy comparison](https://www.speakeasy.com/blog/ai-agent-framework-comparison)).

**Weaknesses:** Bundles a lot — if you want only workflows you take memory + RAG too. RAG implementation is fine but not differentiated. The "Studio + Cloud" story is split-brain (local UI vs. hosted) — it's not yet clear which is canonical. Voice is included but feels like surface area, not depth.

**User reviews:** Mastra hit HN front page Feb 2025 and went 1.5k → 7.5k stars in a week ([HN discussion thread referenced in Mastra blog](https://mastra.ai/blog/using-ai-sdk-with-mastra)). Recurring positive theme: "TS-native, finally." Recurring negative: bundle size, opinionated on persistence.

**What's sticky:** Studio + the "everything in one repo, type-safe end to end" promise. This is the bar Fuze must meet on DX.

### LangGraph (langchain-ai) — DX 3/5, deepest production story

Graph-native execution, durable checkpointing at every node, human-in-the-loop interrupts that pause the runtime and persist state, deepest LangSmith tracing ([LangGraph overview](https://docs.langchain.com/oss/python/langgraph/overview), [LangGraph 1.0 announcement](https://blog.langchain.com/langchain-langgraph-1dot0/)). Adopted by Uber, LinkedIn, Klarna for production agents. The 1.0 release locked in durable execution semantics: a 10-step workflow that crashes at step 3 resumes at step 3, no replay.

**Strengths:** Real durability, real human-in-the-loop, real observability via LangSmith. Multi-agent graphs work. State management with reducers is principled.

**Weaknesses:** Boilerplate. Repeatedly cited in 22-developer interview study and on Reddit/HN as "verbose," "enterprise-shaped," "feels like a wrapper of wrappers" ([critiques summarized at Latenode community](https://community.latenode.com/t/why-are-langchain-and-langgraph-still-so-complex-to-work-with-in-2025/39049), [Saeed Hajebi critique](https://medium.com/@saeedhajebi/langgraph-is-not-a-true-agentic-framework-3f010c780857)). TypeScript port is a second-class citizen. The graph DSL, while powerful, has a learning cliff that is fatal for the TS audience Fuze wants.

**What's sticky:** Durable execution. This is *the* feature competitors copy. Fuze must ship it.

### Vercel AI SDK — DX 5/5, ubiquitous, narrow

Now at v6 with first-class `Agent` abstraction, `ToolLoopAgent` for production tool loops, full MCP support, tool execution approval, and DevTools ([AI SDK 6 release](https://vercel.com/blog/ai-sdk-6)). Streaming to React/Svelte/Vue is best-in-class — nothing else is even close on chat UI ergonomics.

**Strengths:** "engine, not car" — stays in its lane and is excellent there. `streamText` with multi-step tools just works. Tool approval flows are actually shippable.

**Weaknesses:** Not a workflow framework. Not a memory framework. No durable execution story. By design — it's a layer, not a platform. Mastra explicitly builds *on top of it*.

**What's sticky:** Streaming + React hooks. Don't try to compete here; integrate.

### OpenAI Agents SDK (Python + TS port) — DX 4/5, OpenAI-leaning

April 2026 evolution introduced sandbox execution, native bash/file/edit harness, and code mode — Python first, TS port follows ([OpenAI's evolution post](https://openai.com/index/the-next-evolution-of-the-agents-sdk/), [TechCrunch coverage](https://techcrunch.com/2026/04/15/openai-updates-its-agents-sdk-to-help-enterprises-build-safer-more-capable-agents/)). Now supports 100+ non-OpenAI models via Chat Completions. Handoffs between agents are first-class.

**Strengths:** Sandbox + harness is competitive with Claude Agent SDK. Realtime voice is good. Tracing dashboard is clean. Sessions for memory are useful.

**Weaknesses:** Provider gravity (OpenAI defaults dominate examples). Sandbox/harness is Python-first; TS will lag. Less flexible than LangGraph for arbitrary control flow.

**What's sticky:** "Just works with OpenAI" + the new sandbox. Fuze should match the harness shape but stay provider-neutral.

### Anthropic Claude Agent SDK — DX 5/5 (for Claude), tools-first

Built-in bash, file read/edit/write, web search, Playwright plugin first-class. PostToolUse/PostToolUseFailure hooks now ship `duration_ms`. PowerShell auto-approval. Subagent and SDK MCP server reconfigurations connect in parallel ([NPM package](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), [Anthropic engineering post](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk)). The architectural bet: don't ship a vector DB, ship grep + filesystem and let the model search.

**Strengths:** The shortest path from "I have an idea" to "Claude is doing things in my filesystem." Tool ergonomics are great. The bash-replaces-RAG architecture is now mainstream.

**Weaknesses:** Anthropic-only. No graph workflows. Claude Code is a CLI product wearing an SDK costume — productionizing for non-coding agents is awkward.

**What's sticky:** The tool catalog and the philosophy. Fuze's agent stance should explicitly endorse this: bash, file, fetch, grep — first-class, signed, replayable.

### CrewAI — DX 3/5, popular, fragile

Role-based "crew" abstraction (researcher/writer/analyst with goals + backstories), Flows for event-driven orchestration, claimed 450M agents/month and 60% of US Fortune 500 usage as of early 2026 ([CrewAI homepage](https://crewai.com/), [CrewAI Flows 2026 guide](https://www.jahanzaib.ai/blog/crewai-flows-production-multi-agent-guide)).

**Strengths:** Fastest scaffolding for "demo a multi-agent thing." Good for content workflows.

**Weaknesses:** GitHub issues paint a worrying picture: agents not actually invoking tools (#3154), ChromaDB embedding dimension mismatches (#2464), embedchain dependency conflicts (#2919), crashes on first OpenAI rate limit, a security vulnerability that exposed an admin GitHub token in error responses ([CrewAI issues page](https://github.com/crewAIInc/crewAI/issues), [Aembit security writeup](https://aembit.io/blog/crewai-github-token-exposure-highlights-the-growing-risk-of-static-credentials-in-ai-systems/)). Practitioner Ondřej Popelka: hard to unit-test ([Medium: practical lessons](https://ondrej-popelka.medium.com/crewai-practical-lessons-learned-b696baa67242)). The "agent backstory" pattern is mostly aesthetic — it doesn't reliably change model behavior.

**What's sticky:** The intuition pump — "engineering team but for AI" sells well. Underneath, it's brittle.

### PydanticAI — DX 5/5 (for Python), strong typed story

v1.85.1 as of April 22, 2026, 16.5k stars, "FastAPI for agents" positioning ([PydanticAI docs](https://ai.pydantic.dev/)). Durable execution via Temporal/DBOS integration ([Temporal blog](https://temporal.io/blog/build-durable-ai-agents-pydantic-ai-and-temporal)). Logfire is genuinely the best-looking observability surface in the field, SOC2 Type II ([Logfire on GitHub](https://github.com/pydantic/logfire)).

**Strengths:** Type-safety throughout the loop is the cleanest in Python. Logfire is the bar for what tracing UX should feel like. ~30 model providers.

**Weaknesses:** Python-only. Temporal as the durability layer is heavy. Less of a "studio" experience than Mastra.

**What's sticky:** Logfire UI + the typed-end-to-end promise. Fuze's TS dashboard should aspire to Logfire's information density and immediacy.

### Smolagents (HuggingFace) — DX 4/5, philosophy in 1000 lines

"Agents that write Python instead of JSON tool calls." 30% fewer LLM steps, 44.2% on GAIA vs 7% for GPT-4-Turbo ([smolagents GitHub](https://github.com/huggingface/smolagents), [HF blog](https://huggingface.co/blog/smolagents)). Sandboxes via E2B, Modal, Docker, or Pyodide+Deno WASM. ~26k stars from 3k a year prior.

**Strengths:** The "code-as-action" thesis is real and well-executed. Sandbox options are mature. Minimal API.

**Weaknesses:** Library, not platform. No durable execution, no first-class workflows. Hub integration is HF-specific.

**What's sticky:** The code-as-action insight. Fuze should bake this in: when an agent needs to do five tool calls in a sequence, it should be allowed to write a *small script* and run it once, not chain five tool calls. This is also where compliance leverage is largest — a script run is one signed span instead of five.

---

## 3. Feature-by-feature analysis

For each feature: who does it well · build cost (S/M/L) · compliance amplifier (Y/N/neutral) · ranked recommendation.

### Workflows / graphs / durable execution
- **Best in class:** LangGraph (depth), Mastra (DX), Temporal+PydanticAI (rigor).
- **Build cost:** L. This is real engineering: state persistence, suspend/resume, replay semantics.
- **Compliance amplifier:** Y, *strongly*. A signed, hash-chained workflow execution where every step is a span and the run-root is signed is a thing no competitor ships and no competitor structurally can without rebuilding their evidence layer.
- **Recommendation:** **Ship now.** This is the #1 feature. Spec it as "durable workflows where every step gets a receipt."

### Tool ergonomics (Zod schemas, decorators, streaming results)
- **Best in class:** Vercel AI SDK, Mastra, PydanticAI.
- **Build cost:** S–M.
- **Compliance amplifier:** Y. Typed inputs/outputs make tool spans richer audit artifacts.
- **Recommendation:** **Ship now.** Fuze SDK should have the cleanest Zod tool API in TS. This is a DX hygiene factor, not differentiator — but absence is fatal.

### Built-in tool catalog (bash, fetch, file, grep, web)
- **Best in class:** Claude Agent SDK.
- **Build cost:** M for the tools, S each, but L for "make every one signed and replayable."
- **Compliance amplifier:** Y, *strongly*. Each tool call as a hash-chained span is exactly the bash-replaces-RAG insight monetized as audit evidence.
- **Recommendation:** **Ship now.** Bash, fetch, file (read/write/edit), grep, glob. These are table stakes after Claude Code, and they compound with evidence.

### RAG / vector retrieval
- **Best in class:** Mastra (built-in), CrewAI (built-in but fragile), LangChain (most mature).
- **Build cost:** M (it's a wrapper around pgvector or similar).
- **Compliance amplifier:** Neutral. A retrieval call is a span like any other; embedding quality is opaque.
- **Recommendation:** **Ship later, as an opt-in tool, not the default retrieval path.** See section 4. The Anthropic/Augment/Vercel consensus has shifted: embeddings are now a *tool*, not infrastructure.

### Memory (short-term, long-term, semantic)
- **Best in class:** Mastra, CrewAI, OpenAI Agents SDK (sessions).
- **Build cost:** M. Conversation thread persistence is easy; semantic memory is harder.
- **Compliance amplifier:** Y, with care. Memory is a privacy hazard under GDPR — but a *signed, replayable, redactable* memory is differentiated.
- **Recommendation:** **Ship next.** Conversation memory + a CLAUDE.md-style file-based working memory first. Semantic memory only after vector retrieval lands.

### Browser automation
- **Best in class:** Claude Agent SDK + Playwright MCP plugin (DOM-driven, accessibility-tree first), Stagehand for hybrid.
- **Build cost:** M for the wrapper, L for "screenshots in audit trail."
- **Compliance amplifier:** Y, *strongly*. A browser session with hash-chained screenshots and DOM snapshots is a singular audit artifact. "We can prove what the agent saw" is a story Mastra structurally cannot tell.
- **Recommendation:** **Ship next.** Use Playwright + accessibility tree (DOM-driven, not vision). Avoid stealth/anti-detection — it conflicts with EU-trust brand. ([Browser automation comparison 2026](https://www.digitalapplied.com/blog/browser-automation-ai-agents-playwright-stagehand-2026))

### Voice / multimodal
- **Best in class:** Mastra, OpenAI realtime.
- **Build cost:** L.
- **Compliance amplifier:** Neutral-to-negative. Voice creates more PII surface area, not less, and the EU compliance story for voice-as-evidence is murky.
- **Recommendation:** **Skip.** See section 6.

### Evals (offline + in-prod)
- **Best in class:** Mastra (Studio), PydanticAI (Logfire), LangGraph (LangSmith).
- **Build cost:** M for offline scorers, L for in-prod scoring + drift detection.
- **Compliance amplifier:** Y. Evidence-grade evals are a known gap in the market.
- **Recommendation:** **Ship next.** Offline scorers first (LLM-as-judge, structured assertions). In-prod scoring after observability lands.

### Deployment (serverless, durable, edge)
- **Best in class:** Mastra Cloud, LangGraph Platform, Vercel.
- **Build cost:** L.
- **Compliance amplifier:** Y for EU residency claim. Hosting in EU regions, with attestation, is the brand.
- **Recommendation:** **Ship later.** First make the SDK self-hostable cleanly with EU-region recipes (Hetzner, Scaleway, OVH). A managed Cloud is Phase 7+, not now.

### Multi-agent orchestration / handoffs
- **Best in class:** OpenAI Agents SDK (handoffs), CrewAI (crews — but flaky), Claude Agent SDK (subagents).
- **Build cost:** M (it's mostly tool-call composition).
- **Compliance amplifier:** Y for handoff approvals (replay-protected approvals are exactly what Fuze ships).
- **Recommendation:** **Ship next, but light.** Handoffs and subagents — yes. "Crew of AI employees with backstories" — no. See section 6.

### Streaming UX
- **Best in class:** Vercel AI SDK (token + tool result streaming to React).
- **Build cost:** S if you build on AI SDK; L if you don't.
- **Compliance amplifier:** Neutral.
- **Recommendation:** **Ship now, by integration.** Use AI SDK as the streaming layer. Don't reinvent.

### MCP support
- **Best in class:** All major frameworks now have it ([12-framework comparison](https://clickhouse.com/blog/how-to-build-ai-agents-mcp-12-frameworks)).
- **Build cost:** S–M.
- **Compliance amplifier:** Y. MCP server connections are exactly the kind of supply-chain edge that wants to be attested and pinned.
- **Recommendation:** **Ship now.** Plus: be the first framework to ship "signed MCP server connections" — pinned hashes, revocation, audit logs of which MCPs were active during a run.

### Observability / tracing
- **Best in class:** Logfire (UI), LangSmith (depth).
- **Build cost:** L.
- **Compliance amplifier:** Y, *but Fuze already ships this*. The hash-chain spans ARE the trace.
- **Recommendation:** **Ship now (it's the existing moat).** The work is presentation: a Logfire-quality UI on top of the existing evidence chain.

### Type safety
- **Best in class:** PydanticAI, Mastra, Vercel AI SDK.
- **Build cost:** S (built into the language choice).
- **Compliance amplifier:** Y. Typed tool boundaries make spans more useful as evidence.
- **Recommendation:** **Ship now.** Non-negotiable for TS-first SDK.

### Provider neutrality
- **Best in class:** PydanticAI, Mastra, AI SDK.
- **Build cost:** S if you build on AI SDK, M otherwise.
- **Compliance amplifier:** Y. EU buyers want Mistral/Anthropic/EU-hosted models, not OpenAI lock-in.
- **Recommendation:** **Ship now.** Use Vercel AI SDK as the provider layer. Document Mistral, Anthropic, and self-hosted Llama as first-class.

---

## 4. The bash-vs-RAG thesis

The team's hypothesis: **for structured, grep-able corpora, bash + grep + filesystem tools beat vector RAG. For unstructured prose (legal, tickets, transcripts), embeddings still win.** This is correct, with refinements. The market consensus has moved decisively in this direction over 2025–2026.

### Primary sources (verified)

1. **Anthropic engineering — "Code execution with MCP"** ([anthropic.com/engineering/code-execution-with-mcp](https://www.anthropic.com/engineering/code-execution-with-mcp)). The headline number: a Google-Drive-to-Salesforce workflow went from 150,000 tokens (passing tool results through the model) to 2,000 tokens (executing code locally and passing only the result). 98.7% reduction. The recommendation: when agents face "hundreds or thousands of tools across dozens of MCP servers," code execution wins on context, latency, cost, and privacy. Caveat from Anthropic itself: "code execution introduces its own complexity," requiring sandboxing and resource limits.

2. **Anthropic / Boris Cherny on Claude Code's retrieval architecture.** Anthropic built a RAG pipeline with embeddings, vector DB, chunking — then tested agentic search alongside it. Cherny: agentic search "outperformed everything. By a lot. And this was surprising." ([summarized at Vadim's blog: Claude Code Doesn't Index Your Codebase](https://vadim.blog/claude-code-no-indexing), [Robert Heubanks reproduction](https://robertheubanks.substack.com/p/anthropic-replaced-their-rag-pipeline)). Filesystem tools only — `ls`, `find`, `grep`, `cat` — no embeddings, no vector DB, no preprocessing.

3. **Augment / Jason Liu — "Why Grep Beat Embeddings in Our SWE-Bench Agent"** ([jxnl.co](https://jxnl.co/writing/2025/09/11/why-grep-beat-embeddings-in-our-swe-bench-agent-lessons-from-augment/)). Key insight: vector search wasn't broken; it just wasn't the bottleneck. "Improving embedding models doesn't necessarily improve end-to-end performance because agents are persistent — they'll eventually find what they need even with suboptimal tools." Hybrid recommendation: expose embedding models *as tools* the agent can call alongside grep.

4. **Vercel — replaced their internal knowledge agent's vector DB with grep** ([summarized at ThamizhElango Natarajan's writeup](https://thamizhelango.medium.com/rag-is-broken-vercel-ditched-vector-databases-and-built-a-knowledge-agent-with-grep-instead-7f9e36532b23)). The Vercel team — who literally ship the AI SDK — chose tool-calling over vectors for their own internal docs agent.

5. **Anthropic — "Contextual Retrieval"** ([anthropic.com/news/contextual-retrieval](https://www.anthropic.com/news/contextual-retrieval)). When you *do* need vectors, contextual embeddings + contextual BM25 reduce failed retrievals by 49%, and 67% with reranking. Important: this is Anthropic's *recommendation for when RAG is appropriate* — not a refutation of the agentic-search position. The two coexist: agentic for code/structured, contextual RAG for prose at scale.

### When tools-only fails (the embeddings case)

- **Vocabulary mismatch.** User searches "revenue growth drivers"; document discusses "factors contributing to increased sales." Grep returns nothing. ([Nuss-and-Bolts: Lost Nuance of Grep vs Semantic](https://www.nuss-and-bolts.com/p/on-the-lost-nuance-of-grep-vs-semantic)).
- **Unstructured prose at scale.** Legal documents with definitions sections that govern interpretation, ticket archives, support transcripts, NPS responses — semantic chunking and embeddings remain appropriate ([Weaviate chunking strategies](https://weaviate.io/blog/chunking-strategies-for-rag), [ipchimp.co.uk on RAG for legal](https://ipchimp.co.uk/2024/02/16/rag-for-legal-documents/)).
- **Token burn at scale.** Milvus' counter-argument: grep-only retrieval can burn dramatically more tokens than a single embedding query when the corpus is large and the agent is forced to do many iterative searches ([Milvus blog](https://milvus.io/blog/why-im-against-claude-codes-grep-only-retrieval-it-just-burns-too-many-tokens.md)). This is real. For thousand-page corpora, agentic search alone is wasteful.
- **Non-text content.** Video, audio, image search — embeddings or no retrieval.

### When tools-only wins (the bash case)

- **Code.** Definitively. Cursor, Claude Code, Devin, Augment, Aider — none use embeddings as the primary retrieval path. Grep + AST + LSP + filesystem.
- **Structured docs (markdown trees, configs, schemas).** Same shape as code.
- **Auditability requirements.** Every grep is a transparent operation; every embedding query is a black box ("why was this chunk ranked third?"). For Fuze's compliance brand, this matters more than for anyone else.
- **Freshness.** No re-indexing, no staleness, no "the embedding model was upgraded and the vectors don't match."

### Conclusion for Fuze

**Ship the bash/grep/file/fetch tools first as signed primitives.** Make every operation a hash-chained span with the actual command and output captured in evidence. Do *not* ship a default vector-RAG path in v1.

**Ship vector retrieval second, as an opt-in `vectorSearch` tool the agent can call** alongside grep — same as Augment's hybrid recommendation. Implementation: contextual embeddings (Anthropic-style), pluggable backend (pgvector default, Qdrant/Weaviate optional), and crucially: **every retrieval is a span with the query, the chunk IDs, and the embedding model version** — so even the opaque path is auditable.

**Build cost ranking:** filesystem tools (S, ship now) << vector retrieval as opt-in tool (M, ship in 2 quarters) << knowledge graph / hybrid retrieval (L, year+ out, only if a customer asks).

The strategic line for the agent product page:
> *"Fuze agents read your codebase the way Claude Code does — with grep, find, and your filesystem — not with a stale vector index. When you do need semantic retrieval, it's a tool the agent calls, and every query is signed."*

---

## 5. Ranked roadmap recommendation

Top 5 features, in order. Scope is approximate.

**1. Durable, signed workflow runtime (graph-shaped, suspendable)** — *L scope, 2–3 engineer-quarters.*
Declarative DAGs in TypeScript with branching, parallel, suspend/resume. State persisted between steps; runtime can crash and restart. Every step emits a span into the existing evidence chain; the run-root signs the entire DAG execution. This is the #1 leverage point: it's table-stakes for 2026 agent frameworks AND it's the largest compliance amplifier. The marketing line writes itself: "the only agent framework where your workflow execution is a signed, replayable artifact."

**2. First-class signed tool catalog (bash, fetch, file, grep, glob, edit)** — *M scope, 1–2 engineer-quarters.*
Match the Claude Agent SDK's tool shape. Zod schemas, streaming results, tool approval flows, replay-protected approvals (Fuze already has this primitive). Each tool call is a hash-chained span with full inputs and outputs. Code-as-action support: let the agent write a script and run it once, signed as a single span — borrow from smolagents.

**3. Browser automation with attested sessions** — *M–L scope, 2 engineer-quarters.*
Playwright wrapper with DOM/accessibility-tree-first interactions (not vision), screenshots and DOM snapshots in the evidence chain, replay-protected for sensitive actions (form submits, clicks on payment elements). Avoid stealth, anti-detection, captcha-bypass — both for legal/EU-trust reasons. The differentiator: "the only browser-agent runtime where you can prove, six months later, exactly what the agent saw and clicked."

**4. Evals (offline scorers + in-prod scoring)** — *M scope, 1.5 engineer-quarters.*
LLM-as-judge scorers, structured assertions over span outputs, eval datasets versioned alongside agent definitions. In-prod scoring as a sampling layer over the existing trace pipeline. The pitch: "your evals run on the same evidence your auditor reads."

**5. Vector retrieval as an opt-in, signed tool** — *M scope, 1 engineer-quarter.*
pgvector default backend, contextual-embeddings pipeline (Anthropic-style), every query is a span. Explicit positioning: not the default retrieval path. Fuze's stance is "agentic search first, vectors when prose demands it."

**Honorable mentions (Phase 7+):**
- Code execution sandbox (E2B-style or self-hosted via Firecracker), with the run captured as a signed span. High value but depends on infra investment.
- A Studio-equivalent dashboard view on top of the existing trace store. The dashboard repo (`fuze-dashboard`) is the right home; Logfire is the aesthetic bar.
- MCP server attestation layer — pin and sign which MCP servers were live during a run.

---

## 6. The "skip" list

Be opinionated. These features other frameworks ship are not net-positive for Fuze given the EU-compliance brand.

### Voice (TTS / STT / STS)
Mastra and OpenAI both ship this. Skip it.
- Voice creates a new PII surface area (speaker biometrics, accent metadata) that complicates GDPR posture.
- Voice agents are very rarely the right shape for compliance-sensitive workflows; a typed text trace is auditable, a synthesized voice clip is a different evidentiary class.
- Voice frameworks are a perpetual integration tax (provider churn: ElevenLabs, Cartesia, OpenAI realtime, Deepgram all moving fast).
- *Compliance amplifier: net negative. Skip.*

### Stealth browser tooling / anti-detection / captcha bypass
Some frameworks (and a long tail of third-party tools) ship these. Hard skip.
- Direct conflict with EU-trust brand. "We help your agent evade detection" is a non-starter for a compliance platform.
- Legal exposure (CFAA-style claims, ToS violations).
- The DOM-driven Playwright path is more reliable on common tasks anyway (12–17 percentage points per [browser automation comparison 2026](https://www.digitalapplied.com/blog/browser-automation-ai-agents-playwright-stagehand-2026)).

### "Crew of AI agents with backstories and roles"
CrewAI's signature aesthetic. Fuze should ship handoffs and subagents — yes — but skip the *theatre* of named roles with fictional backstories.
- The pattern is mostly demoware. CrewAI's GitHub issues show the underlying machinery is brittle: agents that simulate tool use without invoking, dependency conflicts, crash-on-rate-limit ([issue #3154](https://github.com/crewAIInc/crewAI/issues/3154)).
- "Researcher → Writer → Editor" abstractions don't add capability over a signed graph workflow with named nodes.
- The right Fuze framing is "subagents are workflow nodes that happen to use an LLM." Less roleplay, more rigor.

### A heavy "everything-and-the-kitchen-sink" framework
Mastra is moving toward this; LangChain has been there for years. Fuze should resist.
- Bundle = lock-in = surface-area = bug surface = compliance-audit surface.
- Better positioning for Fuze: "the SDK is small; the receipts are large."
- The dashboard (separate repo per [fuze repo layout](../memory/MEMORY.md)) is where presentation features go. The SDK stays minimal.

### A second-class Python port that lags TS
PydanticAI, smolagents, and OpenAI Agents (Python) own Python. Fuze should ship a Python SDK (compliance teams skew Python), but explicitly position it as a *bindings* layer over a TS-shaped core, not a parallel implementation.
- One source of truth. One audit chain shape. One workflow grammar.

### Stand-alone built-in vector DB
Mastra, CrewAI, and LangChain ship this. Skip.
- See section 4 — vectors are a *tool*, not infrastructure.
- The team gets to focus engineering on the moat (signed workflows, evidence chain) instead of a half-baked vector store competing with pgvector / Qdrant / Weaviate.

---

## Sources

- Mastra: [mastra.ai](https://mastra.ai/), [GitHub](https://github.com/mastra-ai/mastra), [docs](https://mastra.ai/docs), [framework page](https://mastra.ai/framework), [blog: choosing a JS agent framework](https://mastra.ai/blog/choosing-a-js-agent-framework), [voice docs](https://mastra.ai/docs/agents/adding-voice), [generative.inc complete guide 2026](https://www.generative.inc/mastra-ai-the-complete-guide-to-the-typescript-agent-framework-2026), [WorkOS quickstart](https://workos.com/blog/mastra-ai-quick-start)
- LangGraph: [GitHub](https://github.com/langchain-ai/langgraph), [docs overview](https://docs.langchain.com/oss/python/langgraph/overview), [LangGraph 1.0 announcement](https://blog.langchain.com/langchain-langgraph-1dot0/), [AlphaBold production analysis](https://www.alphabold.com/langgraph-agents-in-production/), [Saeed Hajebi critique](https://medium.com/@saeedhajebi/langgraph-is-not-a-true-agentic-framework-3f010c780857), [Latenode community: LangGraph complexity](https://community.latenode.com/t/why-are-langchain-and-langgraph-still-so-complex-to-work-with-in-2025/39049)
- Vercel AI SDK: [docs](https://ai-sdk.dev/docs/introduction), [AI SDK 6 release](https://vercel.com/blog/ai-sdk-6), [GitHub](https://github.com/vercel/ai), [Vercel KB on agents](https://vercel.com/kb/guide/ai-agents), [Mastra blog on AI SDK integration](https://mastra.ai/blog/using-ai-sdk-with-mastra)
- OpenAI Agents SDK: [openai.com — next evolution of the Agents SDK](https://openai.com/index/the-next-evolution-of-the-agents-sdk/), [TS GitHub](https://github.com/openai/openai-agents-js), [Python GitHub](https://github.com/openai/openai-agents-python), [docs](https://openai.github.io/openai-agents-python/), [TechCrunch coverage](https://techcrunch.com/2026/04/15/openai-updates-its-agents-sdk-to-help-enterprises-build-safer-more-capable-agents/), [Temporal integration announcement](https://temporal.io/blog/announcing-openai-agents-sdk-integration)
- Claude Agent SDK: [Anthropic engineering: building agents with Claude Agent SDK](https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk), [npm package](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk), [code.claude.com docs](https://code.claude.com/docs/en/agent-sdk/overview), [Python GitHub](https://github.com/anthropics/claude-agent-sdk-python), [Promptfoo provider docs](https://www.promptfoo.dev/docs/providers/claude-agent-sdk/)
- CrewAI: [GitHub](https://github.com/crewaiinc/crewai), [crewai.com](https://crewai.com/), [docs](https://docs.crewai.com/), [CrewAI Flows production guide](https://www.jahanzaib.ai/blog/crewai-flows-production-multi-agent-guide), [Issues page](https://github.com/crewAIInc/crewAI/issues), [issue #3154 (tools not invoked)](https://github.com/crewAIInc/crewAI/issues/3154), [issue #2464 (ChromaDB dimension)](https://github.com/crewAIInc/crewAI/issues/2464), [Aembit security writeup](https://aembit.io/blog/crewai-github-token-exposure-highlights-the-growing-risk-of-static-credentials-in-ai-systems/), [Ondřej Popelka practical lessons](https://ondrej-popelka.medium.com/crewai-practical-lessons-learned-b696baa67242)
- PydanticAI: [docs](https://ai.pydantic.dev/), [PyPI](https://pypi.org/project/pydantic-ai/), [Logfire GitHub](https://github.com/pydantic/logfire), [Logfire product page](https://pydantic.dev/logfire), [Temporal + PydanticAI](https://temporal.io/blog/build-durable-ai-agents-pydantic-ai-and-temporal), [DataCamp guide](https://www.datacamp.com/tutorial/pydantic-ai-guide), [Real Python](https://realpython.com/pydantic-ai/)
- Smolagents: [GitHub](https://github.com/huggingface/smolagents), [HF blog: introducing smolagents](https://huggingface.co/blog/smolagents), [docs](https://huggingface.co/docs/smolagents/en/index), [DeepLearning.AI course](https://learn.deeplearning.ai/courses/building-code-agents-with-hugging-face-smolagents/lesson/txu26/introduction)
- Bash-vs-RAG primary sources: [Anthropic — code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp), [Anthropic — Contextual Retrieval](https://www.anthropic.com/news/contextual-retrieval), [Vadim's blog: Claude Code doesn't index your codebase](https://vadim.blog/claude-code-no-indexing), [Robert Heubanks: testing Anthropic's agentic search](https://robertheubanks.substack.com/p/anthropic-replaced-their-rag-pipeline), [Jason Liu / Augment: why grep beat embeddings on SWE-Bench](https://jxnl.co/writing/2025/09/11/why-grep-beat-embeddings-in-our-swe-bench-agent-lessons-from-augment/), [Morph: agentic search](https://www.morphllm.com/agentic-search), [AkitaOnRails: is RAG dead?](https://akitaonrails.com/en/2026/04/06/rag-is-dead-long-context/), [MindStudio: why Cursor, Claude Code, Devin use grep](https://www.mindstudio.ai/blog/is-rag-dead-what-ai-agents-use-instead), [Nuss-and-Bolts: lost nuance of grep vs semantic](https://www.nuss-and-bolts.com/p/on-the-lost-nuance-of-grep-vs-semantic), [Milvus counter-argument: grep burns too many tokens](https://milvus.io/blog/why-im-against-claude-codes-grep-only-retrieval-it-just-burns-too-many-tokens.md), [HN: RAG Obituary discussion](https://news.ycombinator.com/item?id=45439997), [HN: Isn't grep RAG?](https://news.ycombinator.com/item?id=45447682), [ThamizhElango Natarajan: Vercel ditched vector DBs](https://thamizhelango.medium.com/rag-is-broken-vercel-ditched-vector-databases-and-built-a-knowledge-agent-with-grep-instead-7f9e36532b23)
- Browser automation: [Playwright Claude plugin](https://claude.com/plugins/playwright), [DigitalApplied: Playwright vs Stagehand 2026](https://www.digitalapplied.com/blog/browser-automation-ai-agents-playwright-stagehand-2026), [Respan: Anthropic Computer Use vs Playwright](https://www.respan.ai/market-map/compare/anthropic-computer-use-vs-playwright)
- MCP / interop: [modelcontextprotocol.io](https://modelcontextprotocol.io/), [ClickHouse: 12-framework MCP comparison](https://clickhouse.com/blog/how-to-build-ai-agents-mcp-12-frameworks), [MCP Wikipedia](https://en.wikipedia.org/wiki/Model_Context_Protocol)
- EU AI Act / compliance: [Raconteur: 2026 deadline guide](https://www.raconteur.net/global-business/eu-ai-act-compliance-a-technical-audit-guide-for-the-2026-deadline), [Augment: EU AI Act 2026 for dev teams](https://www.augmentcode.com/guides/eu-ai-act-2026), [Centurian: agents must prove by Aug 2](https://centurian.ai/blog/eu-ai-act-compliance-2026), [CodeSlick: what an audit trail actually looks like](https://codeslick.dev/blog/eu-ai-act-audit-trail-2026), [AetherLink: agentic AI EU compliance guide 2026](https://aetherlink.ai/en/blog/agentic-ai-multi-agent-orchestration-eu-compliance-guide-2026)
- Cross-framework comparisons: [Speakeasy: choosing an agent framework](https://www.speakeasy.com/blog/ai-agent-framework-comparison), [DigitalApplied: agentic orchestration LangGraph vs CrewAI vs Mastra](https://www.digitalapplied.com/blog/agentic-orchestration-frameworks-langgraph-vs-crewai), [Firecrawl: best open-source agent frameworks 2026](https://www.firecrawl.dev/blog/best-open-source-agent-frameworks), [Langfuse: open-source agent framework comparison](https://langfuse.com/blog/2025-03-19-ai-agent-comparison), [Channel: which frameworks ship](https://www.channel.tel/blog/ai-agent-frameworks-compared-2026-what-ships), [Komelin: Vercel AI SDK vs Mastra vs LangChain vs Genkit](https://komelin.com/blog/ai-framework-comparison)
