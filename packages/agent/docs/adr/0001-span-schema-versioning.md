# ADR 0001 — Span schema versioning

## Status

Accepted, 2026-05.

## Context

`EvidenceSpan` is the unit of the hash-chained run record. As new span kinds land
(`tool.partial`, `workflow.*`, `browser.*`, `retrieval.*`, `mcp.connect`), the
shape will evolve. We need a forward-compatibility rule that lets older signed
runs verify under newer SDKs without rehashing or reissuing. We also need a
backwards-compatibility rule that lets newer runs verify under older verifiers
when the newer additions are purely additive.

## Decision

1. **Field.** `EvidenceSpan` carries an optional top-level
   `spanSchemaVersion: number`. The current shape is **version 1**.

2. **Default-on-absence.** A span without `spanSchemaVersion` is interpreted as
   version 1. `verifyChain` accepts an optional
   `acceptedSchemaVersions: { min, max }`; the default is `{ min: 1, max: 1 }`.
   A span whose declared (or implied) version is outside the accepted range
   fails verification.

3. **Canonical-form invariant for v1.** The version 1 canonical form **MUST
   equal** the pre-versioning canonical form. Concretely: when emitting a v1
   span, `EvidenceEmitter` does **not** add the `spanSchemaVersion` field to
   the span object. Any v2+ emitter must add the field. This means existing
   chains signed before this ADR continue to verify byte-for-byte.

4. **Additive-only changes within a major version.** New optional attributes
   (top-level fields or keys inside `attrs`) may be added without bumping the
   version. Hashes are sensitive to canonical-form changes, but adding a new
   optional field that the emitter only sets in newer runs does not change the
   canonical form of older spans.

5. **Renames are breaking changes.** Renaming any field — top-level or inside
   `common` — bumps the major version. The new code emits v2 spans; verifiers
   must be told to accept `{ min: 1, max: 2 }`. v1 spans continue to verify
   under their v1 canonical form; v2 spans verify under their v2 form.

6. **Migration path for v2.** The procedure: (a) define v2 canonical form
   (including the version field this time), (b) update emitter to emit v2,
   (c) update `verifyChain` default to `{ min: 1, max: 2 }`, (d) document the
   deprecation window for v1 emitters in release notes. Annex IV mappers
   (`@fuze-ai/agent-annex-iv`) enumerate the schema versions they understand;
   a v3 mapper continues to read v1/v2 spans.

## What counts as breaking

- Renaming a field.
- Removing a field that was previously required.
- Changing the canonical encoding (e.g. switching number formats, changing
  attr-redaction rules in a way that alters the hashed bytes for the same
  input).
- Changing the meaning of an existing value (semantic break).

## What does not count as breaking

- Adding a new optional top-level field.
- Adding a new optional key inside `attrs`.
- Adding a new span kind (`tool.partial`, etc.) — existing verifiers see it as
  another span and chain over it normally.
- Adding new accepted values to an existing enum, provided older code treats
  unknown values as opaque and not as a verification failure.

## Consequences

- Every signed chain remains verifiable across SDK upgrades within the
  declared range.
- Operators upgrading the SDK do not have to re-sign or re-emit historical
  runs.
- A version bump is a deliberate decision with a documented migration; it is
  not automatic. Drift between Annex IV mapper version and span version is
  caught at the mapper boundary, not at chain verification.
