# agent-employment-screening

Reference agent that screens job candidates and produces a hire/reject/hold recommendation. The recommendation step always requires a human-in-the-loop sign-off before it persists. This is the **Annex III high-risk** shape: an Article 22 automated decision over employment data, gated by Article 14 human oversight.

## Why this is high-risk

EU AI Act **Annex III, paragraph 4(a)** lists "AI systems intended to be used for recruitment or selection of natural persons" as high-risk. Producing a screening recommendation falls squarely inside that scope, so the agent is configured with:

- `annexIIIDomain: 'employment'`
- `producesArt22Decision: true`
- a non-optional `art14OversightPlan` referencing a documented oversight procedure and trainer
- `record_recommendation` tool wired with `needsApproval: () => true`, so the loop **suspends** before persisting

The runtime refuses to start if `art14OversightPlan` is missing (validated in the loop's preflight) and refuses to call the recommendation tool without a signed approval token issued by an overseer.

## Articles that apply

| Article | How it shows up in this agent |
| --- | --- |
| GDPR Art. 6(1)(f) — legitimate interests | `lawfulBasis: 'legitimate-interests'` (the controller's business interest in selecting candidates) |
| GDPR Art. 22 — automated decision-making | `producesArt22Decision: true`; final tool call is suspended pending human approval |
| GDPR Art. 30 — records of processing | every span is hash-chained; `verifyChain(records)` is part of the evaluation |
| AI Act Art. 14 — human oversight | `art14OversightPlan` ref; suspend/resume cycle proves a human reviewed the decision |
| AI Act Art. 26 — deployer obligations | per-run evidence with `fuze.subject.ref`, retention 365 days for the decision |

## Tools

- `lookup_candidate` — fetches the dossier (personal, EU-residency-required)
- `summarize_application` — produces a structured summary (personal)
- `record_recommendation` — persists the final decision (personal, **always** needs approval)

## DPIA notes

- **Categories of data subjects**: applicants for advertised roles. No special-category data is collected by the agent itself.
- **Categories of personal data**: pseudonymous candidate ID, application metadata, role applied for, citizenship for right-to-work checks. `subjectRef` carries an HMAC, never a plaintext identifier.
- **Recipients**: only the controller's HR function. No third-country transfer. `residencyRequired: 'eu'` is enforced at the type level on every personal tool.
- **Risk mitigations**:
  - All recommendations require a human approver with a signed training credential before they persist.
  - Hash-chained evidence covers every model call, tool call, and policy decision.
  - `lawfulBasis` is checked against each tool's `allowedLawfulBases` at startup.
  - Retention: 90 days hash, 30 days full content, 365 days for the final decision.

## Lawful basis

`legitimate-interests` (Art. 6(1)(f)) for screening logic itself; `contract` (Art. 6(1)(b)) becomes available after the candidate signs an offer letter, which is out of scope for this agent.

## Retention policy

```
{ id: 'employment.screening.v1', hashTtlDays: 90, fullContentTtlDays: 30, decisionTtlDays: 365 }
```

The 365-day decision retention is calibrated to the EU statute of limitations on discrimination claims in most member states.

## Running

```
npm install
npm run run     # runs index.ts, agent suspends pending approval
npm run evals   # runs evals.ts against five candidates
```

Both scripts use scripted models so they run offline without provider keys.

## Files

- `index.ts` — agent definition, tools, scripted model
- `evals.ts` — five-case evaluation suite using `@fuze-ai/agent-eval`
