# @fuze-ai/agent-policy-cerbos

Cerbos-compatible `PolicyEngine` adapter for `@fuze-ai/agent`.

## Phase contract

- **Phase 1:** ships a Cerbos-compatible YAML+CEL evaluator (`CerbosCompatPolicyEngine`). Policies are authored in Cerbos resource-policy YAML; conditions use a tiny CEL subset (`R.attr.x == 'literal'`, `R.attr.x in ['a','b']`, `P.attr.x == 'literal'`, `!=`, `&&`, `||`).
- **Phase 2 (this version):** the WASM engine (`CerbosWasmPolicyEngine`) is added alongside the YAML+CEL evaluator. Both pass the same conformance suite. Operators choose at runtime — the YAML+CEL path stays available for environments where the Cerbos CLI build step is not desired.

## WASM engine — operator install

`@cerbos/embedded` is an `optionalDependencies` entry. Operators choosing the WASM path must install it explicitly:

```
npm install @cerbos/embedded
```

The WASM bundle is produced at build time by the Cerbos CLI (Go binary) — not by this package:

```
cerbos compile --output-bundle bundle.wasm policies/
```

`CerbosWasmPolicyEngine` accepts either `bundleBytes: Uint8Array` (already loaded) or `bundlePath: string` (read from disk on first evaluate). If `@cerbos/embedded` is not installed at runtime, `RealWasmEngineFactory.create` throws `CerbosEmbeddedNotInstalledError` with the install instruction. Tests inject `FakeWasmEngineFactory` and never load the real package.

## Hard rules

1. The YAML format is Cerbos-shape: `apiVersion`, `resourcePolicy.{resource,version?,rules}`, `rules[].{actions,effect,condition?}`. Do not invent fields that real Cerbos cannot parse.
2. CEL subset is intentional. New constructs go through Phase 2 (real Cerbos) — do not grow `cel-mini.ts`.
3. Default-deny is the only safe fallback. No allow-on-error.
4. No real network, filesystem, or process calls. The adapter is pure data-in / decision-out.

## Layout

```
src/
  types.ts        Cerbos YAML shapes
  yaml.ts         parse + validate one policy string
  cel-mini.ts     CEL-subset boolean evaluator
  engine.ts       CerbosCompatPolicyEngine
  wasm-types.ts   WasmEngine / WasmEngineFactory contracts + error types
  wasm-engine.ts  CerbosWasmPolicyEngine
  fake-wasm.ts    FakeWasmEngineFactory + FakeWasmEngine for tests
  real-wasm.ts    RealWasmEngineFactory — dynamic-imports @cerbos/embedded
  index.ts        public exports
test/
  yaml.test.ts | cel-mini.test.ts | engine.test.ts | wasm-engine.test.ts
  (both engines run runPolicyConformance)
```
