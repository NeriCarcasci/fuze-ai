# Phase 7 Report: Cockpit Backend

## Packages added

- `@fuze-ai/agent-fria`
  - Public API: `compileFRIA(input)` returns `{ pdf, json }`; `friaTemplate(category)` returns category-specific Article 27 prefill data.
  - Covers all seven FRIA fundamental-rights areas with risk, severity, likelihood, mitigation, and residual-risk fields.

- `@fuze-ai/agent-incident`
  - Public API: `compileIncidentReport(input)` returns `{ pdf, json }`; `deadlineFor(severity)` returns the Article 73 reporting window.
  - Covers organisational context, affected systems, incident timeline, root cause, evidence references, mitigations, and notifications.

- `@fuze-ai/agent-synthesis`
  - Public API: `synthesize(input)` returns tool graph nodes/edges, emergent workflow patterns, anomalies, and daily trend buckets.
  - Pure TypeScript, deterministic, no model calls, no native or ML dependencies.

## Existing packages updated

- `@fuze-ai/agent-annex-iv`
  - Added `compileAnnexIV(input)` returning `{ pdf: Buffer, json: AnnexIVReport }`.
  - PDF cover sheet plus eight Annex IV sections with EU AI Act article references and input-derived metrics.

- `@fuze-ai/agent-compliance`
  - Added unified `compileReport(input)` for `annex-iv`, `fria`, and `incident`.
  - Adds stable SHA-256 `contentHash` over RFC 8785 canonical JSON.

- `@fuze-ai/agent`
  - Added end-to-end report cycle coverage for HITL suspend/resume, Annex IV, FRIA, incident, and synthesis.

## Test count delta

- Added 33 Phase 7 tests:
  - Annex IV compiler: 4
  - FRIA compiler/templates: 12
  - Incident compiler/deadlines: 9
  - Synthesis: 5
  - Unified compliance compiler: 2
  - Agent e2e report cycle: 1

## Verification

- `npm install`: completed.
- `npm run build`: passed.
- `npm test`: passed.
- E2E report-cycle test runtime: about 300ms locally, well under 60s.

## Public API stability commitments

- New report compiler APIs are intended as `0.1.x` stable within the current monorepo phase.
- Input and output interfaces may grow by adding optional fields in minor releases.
- Existing fields, report kind strings, and section identifiers should not be renamed without a major-version change.
- Generated PDF layout is not treated as byte-stable; generated JSON structure and `contentHash` semantics are the stable integration surface.

## Deferred to Phase 8

- Authority-specific Article 73 filing adapters and submission transport.
- Dashboard report browsing, search, and session-style visualizations.
- Longitudinal post-market monitoring rules beyond deterministic daily buckets.
- Rich PDF branding and localisation beyond the current regulatory submission structure.
- Python SDK parity for these report compilers.
