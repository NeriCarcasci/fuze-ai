# @fuze-ai/agent-signing-kms

Production Ed25519 KMS adapters for `@fuze-ai/agent`. Replaces the dev-only `LocalKeySigner`.

## Adapters

- `AwsKmsSigner` / `AwsKmsVerifier` — AWS KMS (Ed25519, 2024+).
- `GcpKmsSigner` / `GcpKmsVerifier` — Google Cloud KMS.
- `AzureKvSigner` / `AzureKvVerifier` — Azure Key Vault.
- `VaultSigner` / `VaultVerifier` — HashiCorp Vault Transit.

## Rules

- Cloud SDKs are `optionalDependencies`. Operators install only what they need. Each adapter lazy-imports its SDK in the constructor or first call; missing SDKs throw `KmsUnavailableError`.
- Each adapter accepts an injected client (`*LikeClient` interface) for testing. The interface only declares the methods we use, not the full SDK surface.
- Each adapter wraps calls in a `CircuitBreaker` (3 failures → open 30s → half-open → closed on first success). Configurable via constructor.
- Batching hooks exist at the type level but are deferred to v2: AWS KMS has no batch sign; per-call is the v1 default for all adapters.
