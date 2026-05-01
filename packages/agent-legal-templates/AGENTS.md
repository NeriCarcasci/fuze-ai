# @fuze-ai/agent-legal-templates

**NOT LEGAL ADVICE.** This package generates document *templates* with placeholders. A qualified lawyer must review every generated artifact before any customer use, signature, or filing. The generator only auto-fills the operational facts derivable from `AgentDefinition` and flags lawyer-review fields.

## Scope

Five generators on top of `@fuze-ai/agent` and `@fuze-ai/agent-compliance`:

1. **DPA** (`generateDpa`) — GDPR Art. 28 controller-processor template, markdown.
2. **SCC selector** (`selectScc`) — picks Module 1/2/3/4 + docking clauses for a given `TransferContext`.
3. **TIA** (`generateTia`) — Schrems II / EDPB 01/2020 Transfer Impact Assessment, markdown.
4. **Sub-processor manifest** (`subProcessorManifest`, `manifestDiff`, `manifestHash`) — content-hashed manifest + diff for change-notice webhooks.
5. **Breach notification** (`generateBreachNotification`) — Art. 33 + Art. 34 packet (markdown + structured JSON).

## Hard rules (this package)

1. **Pure functions only.** No I/O, no clocks (timestamps come in via input), no randomness.
2. **Lawyer-review markers are mandatory in every markdown output.** Any field that requires legal judgement (third-country law analysis, governing-law clause, indemnity caps, notification thresholds) MUST be wrapped in `<!-- LAWYER REVIEW: ... -->` markers so reviewers cannot miss them.
3. **Missing required input is a thrown error, never a silent placeholder.** Templates whose required operational facts are absent must fail loud at generation time.
4. **Manifest hash is canonical.** Same set of sub-processors (regardless of input order) yields the same hash via RFC 8785 canonical JSON + SHA-256.
5. **No `any` in public API.** Discriminated unions and `readonly` everywhere.

## Status

Phase 4. Templates cover the EU baseline; non-EU equivalents (UK IDTA, Swiss FADP) are out of scope for v0.1.
