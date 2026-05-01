# Fuze policies

Cerbos resource policies that gate tool invocation and Annex-III sensitive
data flows. Each `*.yaml` file is a Cerbos `resourcePolicy` document. The
runtime path supports both YAML+CEL evaluation (via `parsePolicy` +
`evaluateCel` in `@fuze-ai/agent-policy-cerbos`) and a compiled WASM bundle
(via `RealWasmEngineFactory` against `@cerbos/embedded`).

## Files

- `tool.default.yaml` — default invocation policy. Allows `public`, allows
  `personal` with tenant context, denies `special-category` outright (must
  be re-allowed by the Annex-III policy on a sovereign tier), and routes
  `business` data through `EFFECT_REQUIRES_APPROVAL`.
- `agent.annex-iii.yaml` — Annex-III gating. Refuses any invocation where
  `R.attr.classification == 'special-category' && R.attr.tier != 'eu-sovereign'`.
  Allows the same classification on `eu-sovereign` tier; allows everything
  else through unchanged.

## YAML format

The minimal shape that `parsePolicy` accepts:

```yaml
apiVersion: api.cerbos.dev/v1
resourcePolicy:
  resource: "<tool-name-or-*>"
  version: <variant>          # optional
  rules:
    - id: <rule-id>           # optional, auto-generated otherwise
      actions: [invoke]       # only `invoke` and `*` are recognised today
      effect: EFFECT_ALLOW    # | EFFECT_DENY | EFFECT_REQUIRES_APPROVAL
      condition:              # optional
        match:
          expr: "R.attr.classification == 'public'"
```

Conditions use a small CEL subset (see `cel-mini.ts`):
- `==`, `!=`
- `in [<list>]`
- `&&`, `||`
- attribute references `R.attr.<key>` (resource) and `P.attr.<key>` (principal)

The resource bindings the runtime injects today are `R.attr.name`,
`R.attr.classification`, plus the tool args spread as additional keys. The
principal bindings are `P.attr.tenant` and `P.attr.principal`. Additional
attributes used by the Annex-III policy (e.g. `R.attr.tier`) must be passed
in via the policy `args` or sourced from a future loop-level binding.

## Compiling the WASM bundle locally

If you have the Cerbos CLI:

```sh
cerbos compile --output-bundle bundles/bundle.wasm policies/
```

The CLI is not part of this repo's toolchain. CI handles the compile via
`.github/workflows/cerbos-bundle.yml` (created by the ops workflow); the
resulting `bundles/bundle.wasm` is consumed by `CerbosWasmPolicyEngine` and
covered by `agent-policy-cerbos/test/wasm-live.test.ts`. The live test is
gated on `CI_LIVE_CERBOS=1` AND the bundle existing on disk, so it stays a
no-op locally.
