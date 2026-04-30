# Product framing

This file exists so that agents (and future contributors) don't helpfully reintroduce concepts we deliberately killed, or build features that are off-strategy.

## What Fuze is

A runtime safety and observability layer for AI agents. Two SDKs (JS, Python), an optional self-hosted daemon, an optional managed cloud ingest, a dashboard.

## Who it's for

Engineering teams running agents in production who need:
- An audit trail that satisfies EU compliance posture (AI Act, GDPR for log retention, eIDAS-style chain integrity).
- Loop and runaway detection that fires *before* the agent burns through its budget.
- A single observability surface across mixed JS+Python stacks.

Not for: hobbyist agent tinkerers, prompt engineers, model evaluators. Different products.

## Positioning

**EU-first.** The default trust posture is local: noop transport, then self-hosted daemon, then opt-in cloud. Cloud ingest is hosted in the EU. We don't try to compete with US-centric observability vendors on glossy dashboards — we compete on evidence, integrity, and data residency.

**Evidence over aesthetics.** A dashboard that shows a hash-verified audit log beats one that shows a prettier chart. Customer wins are made on the audit-trail story, not on visual design.

## What's explicitly out of scope (do not propose)

- **USD / cost / currency tracking as a first-class metric.** We tried it. It's not a viable signal — model prices change, providers vary, and the number was misleading agents into "it's fine, we're under budget" decisions while real risk was elsewhere. Telemetry units are tokens, latency, steps, wall-clock time. If a request comes in for "show me the dollar cost," push back: it's a derived view at the dashboard layer, never a SDK concern.
- **LLM model routing or fallback orchestration.** That's an agent framework's job. We observe and constrain; we don't pick models.
- **Prompt template management, vector store integration, RAG plumbing.** Out of scope. Different product.
- **Consumer-grade UX.** No marketing chrome on the SDK README, no emoji, no animated landing pages embedded in the dashboard. Engineers, not buyers, read our surface.
- **Multi-region cloud beyond EU.** Eventually, maybe. Not now. Don't build for it.

## What's in scope but not yet built

- The cross-language parity test suite (see `.context/testing.md`).
- A dashboard that surfaces the hash-chain verification status as a first-class signal.
- MCP proxy support for tool-call audit (in progress).
- Compensation hooks for side-effect rollback (planned).

## Decision shortcuts

When you're weighing "should we add X":

1. Does it strengthen the audit trail / compliance story? → Yes, consider.
2. Does it appear on a competitor's dashboard but doesn't matter for evidence? → No.
3. Does it require us to track money? → No.
4. Does it work identically in JS and Python without contortion? → If no, redesign or skip.
5. Does it make the SDK heavier (new runtime dep)? → Strong default to no.

## Things we've said we won't do that we should not revisit casually

- Pricing tables in the SDK.
- A hosted "fuze.ai cloud" outside the EU.
- A free tier that includes managed cloud ingest (the noop and self-hosted paths are the free tier — ingest costs us money).
- Native mobile SDKs.

If a contributor asks about any of these, point them at this file. If a customer asks, the answer is "no, and here's why" — never "we'll think about it."
