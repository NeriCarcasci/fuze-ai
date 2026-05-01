# @fuze-ai/agent-signing

Ed25519 signer + verifier adapters that satisfy the `Ed25519Signer` /
`Ed25519Verifier` interfaces defined in
`packages/agent/src/types/signing.ts`.

## What ships here

- `LocalKeySigner` / `LocalKeyVerifier` — file-backed key on disk
  (`~/.fuze/agent-key` by default, mirrors the audit key pattern from
  `packages/core/src/trace-recorder.ts`). Dev / self-host only.
- `EnvKeySigner` — reads PEM keys from environment variables. CI and
  local development only.

## Hard rules

1. **No KMS in this package.** Real KMS adapters (AWS KMS, GCP KMS,
   Azure Key Vault, HashiCorp Vault) land in Phase 4 as separate
   packages. Do not stuff them in here.
2. **`LocalKeySigner` is dev-only.** Production deployments must use a
   KMS-backed signer. The README and any docs must say so.
3. **Only `node:crypto`.** No third-party crypto. The interface is
   small; keep the dependency surface at one package
   (`@fuze-ai/agent`).
4. **No `any` in public API, no `as` casts to silence the checker.**
   Inherits root rules.
