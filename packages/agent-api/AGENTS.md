# @fuze-ai/agent-api

Wire contract for the Fuze Agent HTTP API. Pure types + Zod schemas + an
OpenAPI 3.1 generator. **No runtime logic, no transport.**

## Position

This is the shared contract between three consumers:

- `@fuze-ai/agent-api-server` — reference Node implementation.
- The Fuze dashboard — overseer inbox, evidence viewer.
- The Fuze CLI — operator tool for inspecting runs and submitting decisions.

Cross-SDK parity rule (root AGENTS.md, rule 2) applies. Touching a schema
without updating the matching dashboard/CLI consumer is a parity break.

## Hard rules

1. **Schemas are the source of truth.** TypeScript types are derived via
   `z.infer`. Do not hand-write a type that the schema also defines.
2. **No defaults, no transforms** that change the wire shape. Inputs and
   outputs round-trip; what the server receives is what the client sent.
3. **Path constants live here.** Hard-coded `/v1/...` strings in the server
   or CLI are a smell — import from `paths.ts`.
4. **OpenAPI doc is generated, not maintained.** Edit Zod, regenerate.
