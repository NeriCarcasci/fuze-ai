# @fuze-ai/agent-annex-iv

Maps Fuze evidence span attributes (`gen_ai.*`, `fuze.*`) to EU AI Act Annex IV sections and ISO 42001 controls. Produces a structured `AnnexIvReport` an auditor can read directly.

## Scope

Two mapping flavors:

1. **Commission Annex IV (Aug 2024 draft).** Sections 1–7: system description, data + governance, technical specs, monitoring + logging, test reporting, risk management, post-market monitoring. Concrete attribute lists per sub-clause.
2. **ISO 42001.** Top-level controls only. Lower fidelity than the Commission map; included for cross-walking organizations that already align to 42001.

Both maps share the `AnnexIvMapping` shape (see `src/types.ts`). Add new flavors by exporting another `AnnexIvMapping`.

## Report generator

`generateAnnexIvReport({records, agentDefinition, mapping})` walks the chained span records, counts spans whose `attrs` or `common` carry attributes that satisfy each section, and returns:

- per-section finding (matched spans, gap if zero)
- list of gap section IDs
- agent definition reference (purpose, lawful basis, Annex III domain)

Output is plain JSON-serializable data.

## Hard rules

- No `any` in public API. Section IDs and attribute names are plain strings.
- Maps are static module-level constants — no I/O.
- Treat span attributes as untyped `Record<string, unknown>`; don't bake in tool-specific attribute names.
