# agent-code-gen

Reference agent for code-generation tasks: read a file, propose an edit, write the new file, run the test suite. **No personal data, no Annex III, no Article 22 path.** This is the simplest possible deployment shape under the Fuze Agent framework, included to show what the floor of compliance looks like when no GDPR or AI-Act friction applies.

## Why this is the simplest shape

- All four tools (`bash`, `read_file`, `write_file`, `run_tests`) are `defineTool.public(...)` — `dataClassification: 'public'`.
- No personal data ever enters the agent, so no `subjectRef`, no `residencyRequired`, no `art9Basis`, no Art. 22 considerations.
- `annexIIIDomain: 'none'`, `producesArt22Decision: false`, no `art14OversightPlan` required.
- `lawfulBasis` is set to `legitimate-interests` (the controller running its own test suite under its own legitimate interests). It would also be sound under `contract` if this is a paid SaaS feature for end customers.

The compliance "tax" on this agent is essentially zero — exactly what we want for the routine developer tooling case.

## Sandbox tier flow

The example wires a `StubSandbox` that returns canned `read_file` / `write_file` / `run_tests` outputs and reports `tier: 'vm-managed'`. In production you swap this for `@fuze-ai/agent-sandbox-e2b` (managed) or `@fuze-ai/agent-sandbox-justbash` (self-hosted). The agent loop is sandbox-tier-agnostic; the tool's `threatBoundary` declares what it touches and the runtime checks that the sandbox is consistent.

`bash`, `read_file`, and `run_tests` set `readsFilesystem: true`. `write_file` sets `writesFilesystem: true`. None of them set `egressDomains` to anything other than `'none'`, so the egress audit is empty.

## TrustedInputOnly

Each public tool can opt into a `trustedInputOnly` marker if its arguments are not safe to populate from a free-text model output. In a real deployment you would set this on `bash` to require a shell-quoting pre-processor in front of the model. We do not set it here because the test suite's commands are scripted, but the type-system slot is there.

## Tools

- `bash` — arbitrary shell command (sandbox-only)
- `read_file` — read by path
- `write_file` — write by path + content
- `run_tests` — run the project's test suite

## DPIA notes

Not required: no personal data is processed. The agent's evidence still gets hash-chained, because integrity of build artifacts and reproducibility of CI runs is independently valuable, but there is no Art. 30 record-of-processing obligation here.

## Lawful basis

`legitimate-interests` (Art. 6(1)(f)) — applicable only to the developer's own data. If the agent ever touches a user-uploaded repository, the deployer needs to revisit this and likely add `contract` plus a personal-data classification.

## Retention

```
{ id: 'codegen.v1', hashTtlDays: 30, fullContentTtlDays: 7, decisionTtlDays: 30 }
```

Short retention by default — there is no GDPR or AI-Act minimum because there is no data subject.

## Running

```
npm install
npm run run     # runs index.ts; reads, writes, runs tests
npm run evals   # runs evals.ts; five cases
```

## Files

- `index.ts` — agent definition, four public tools, in-process stub sandbox
- `evals.ts` — five-case suite (completed, hash chain, schema, evidence, policy=allow, token budget, no-PII)
