# @fuze-ai/agent-compliance

Compliance utilities layered on `@fuze-ai/agent`. Three pure-function components: subject-ref HMAC derivation, retention partitioning over evidence streams, DPIA template generation from an `AgentDefinition`.

## Hard rules (this package)

1. **Pure functions only.** No I/O, no clocks, no randomness. Time and secrets are inputs.
2. **Same input + same secret = same hmac.** Subject refs are deterministic so SARs work; tenant secrets isolate tenants.
3. **Retention decisions are partitions, not mutations.** The enforcer returns what to keep and what action to apply; storage layers do the writes.
4. **DPIA output is JSON.** Serializing to PDF/DOCX is out of scope and lives elsewhere.

## Status

Phase 0. Public surface stable enough to wire into a pipeline; risk auto-detection is heuristic and will be extended as the agent definition grows fields.
