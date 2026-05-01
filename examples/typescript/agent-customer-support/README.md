# agent-customer-support

Reference agent that handles customer-support conversations: looks up the customer's profile, searches the public knowledge base, and either resolves the issue inline or escalates with a ticket. Refunds above EUR 100 are gated by a human approver.

This is a **non-Annex-III** agent. It still touches personal data, so GDPR fully applies, but it is **not** an automated decision under Art. 22 because every escalation is either a) within a small refund threshold the controller has explicitly delegated to the agent, or b) routed to a human.

## Lawful basis

`contract` (GDPR Art. 6(1)(b)). The data subject has a contract with the controller; supporting that contract is the processing purpose. This is the lawful basis named on every `personal` tool's `allowedLawfulBases`. The agent's `lawfulBasis: 'contract'` field is checked at startup against each tool — running the agent under any other basis is a type-system error.

## Why not Annex III

Annex III paragraph 5 covers AI used in "creditworthiness" and similar essential-services determinations, paragraph 4 covers employment and worker management, paragraph 8 covers law enforcement, etc. Routine support automation does not appear on the list. We still apply most of the same controls (hash-chained evidence, PII guardrails, residency-required tools) because the framework makes them cheap, but we deliberately set:

- `annexIIIDomain: 'none'`
- `producesArt22Decision: false`

If the deployer ever begins using this agent to **deny** service in a way that produces a legal effect (terminating accounts, blocking access for credit reasons, etc.), the classification has to change and `art14OversightPlan` becomes mandatory.

## Tools

- `lookup_customer` — pulls the customer profile (personal, EU-residency)
- `search_knowledge` — public help-center search (public)
- `escalate` — opens a ticket; refunds over EUR 100 trigger `needsApproval`

## Guardrails

- Input PII guardrail (`creditCard`, `iban`) — refuses prompts that contain card or bank account numbers, since support flows should never need them and they would be a PCI / strong-customer-authentication red flag.
- Tool-result PII guardrail (`creditCard`) — defense in depth on lookup outputs.

## DPIA notes

- **Categories of data subjects**: existing customers under contract.
- **Categories of personal data**: customer ID, plan, last order amount. No payment data, no special-category data.
- **Lawful basis**: Art. 6(1)(b) contract.
- **Mitigations**:
  - PII guardrails block card and bank-account numbers from entering the agent.
  - All personal tools are `residencyRequired: 'eu'`; the model is `residency: 'eu'`. Mixing in a non-EU model would fail startup validation.
  - Refunds over EUR 100 are escalated to a human; the policy engine matches the approval rule on the `refundAmountEur` field.

## Retention

```
{ id: 'support.v1', hashTtlDays: 60, fullContentTtlDays: 14, decisionTtlDays: 180 }
```

Full content is kept only 14 days (long enough to handle in-bound disputes); hashes are kept 60 days for audit; the refund decision is retained 180 days.

## Running

```
npm install
npm run run     # one resolved support case
npm run evals   # five-case suite covering small/medium/edge/kb-only/large-refund
```

The large-refund case is expected to suspend (`status: 'suspended'`) — that's the Art. 6(1)(b)-compatible "we need a person here" branch. The eval suite asserts this directly.

## Files

- `index.ts` — agent definition, three tools, scripted model, two PII guardrails
- `evals.ts` — five cases, seven evaluators (hash chain, evidence shape, token budget, no PII leak, completion vs suspend, policy decision)
