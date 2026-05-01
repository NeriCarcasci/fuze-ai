# @fuze-ai/agent-transparency

Append-only transparency log for run-roots. Anchors `signedRunRoot = sign(chainHead || runId)` to a log so any third party can prove a run-root existed before time T.

## Scope

`TransparencyLog` interface with two adapters:

- `SqliteTransparencyLog` — self-hosted, `node:sqlite`, EU/sovereign default. Each leaf chains via `parent_hash`; Merkle tree built on top with SHA-256 of `(left || right)`.
- `RekorTransparencyLog` — Sigstore Rekor public-good service. Lazy-loads `@sigstore/rekor` if installed, else uses an injectable `fetch`. Opt-in for non-regulated customers.

## Verify-without-log

`verify(proof)` is pure: SHA-256 walk from leaf to root, compared to `proof.rootHash`. No network, no DB, no shared state with the producer. Trust is in the math, not the service.

## Out of scope

- Witnessing / co-signing (Phase 2).
- Log gossip / consistency proofs across operators.
- Anything that requires the verifier to trust the log operator.
