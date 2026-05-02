# Milestone M2 — Provider expansion + EU residency types (2026-05)

## Summary

M2 lands two non-EU model adapters (`openAI`, `anthropic`) and a residency type
system that makes it impossible at compile time to bind a `personal` or
`special-category` tool to a non-EU model. The defaults remain EU (Mistral)
in `quickstart`. The runtime residency check in `loop.ts` continues to operate
unchanged; the type system adds a strictly earlier failure mode.

## Files changed

New files:
- `packages/agent-providers/src/residency.ts` — `ProviderResidency`,
  `ModelProvider<R>`, `ToolDataClass`, `RequiresEuResidency`,
  `CompatibleProvider`, `ToolsCompatibleWith`.
- `packages/agent-providers/src/openai.ts` — `openAI(opts)`,
  `OpenAINotInstalledError`. Wires through `callOpenAiCompat` over global
  fetch; lazy-probes the `openai` package via `createRequire`.
- `packages/agent-providers/src/anthropic.ts` — `anthropic(opts)` overloaded
  on `region: 'us' | 'eu'`, `AnthropicNotInstalledError`. Native Messages-API
  client (system-message partition, content-block parse, tool_use → ToolCall
  mapping). Lazy-probes `@anthropic-ai/sdk`.
- `packages/agent-providers/test/openai.test.ts` (6 tests).
- `packages/agent-providers/test/anthropic.test.ts` (7 tests).
- `packages/agent-providers/test/type-tests.test.ts` (5 vitest suites
  driving compile-time `assertOk` / `assertMismatch` / `@ts-expect-error`).
- `packages/agent-providers/tsconfig.test.json` — strict typecheck for the
  type-tests file (the existing tsconfig excludes `test/`).

Existing files touched:
- `packages/agent-providers/src/index.ts` — re-export new modules.
- `packages/agent-providers/src/mistral.ts` / `scaleway.ts` / `ovh.ts` —
  return type narrowed from `FuzeModel` to `ModelProvider<'eu'>`.
- `packages/agent-providers/package.json` — `peerDependencies` (optional)
  for `openai` and `@anthropic-ai/sdk`; `test` script now runs the
  type-tests typecheck before vitest.
- `packages/agent/src/types/model.ts` — `FuzeModel.residency` widened
  from `'eu' | 'us' | 'unknown'` to `'eu' | 'us' | 'multi' | 'unknown'`.
  Additive, no existing call sites broken.
- `packages/agent/src/agent/define-tool.ts` — `defineTool.personal` and
  `.business` return more specific intersected types
  (`PersonalDataTool` / `BusinessDataTool`) that pin the
  `dataClassification` literal so the constraint can fire.
- `packages/agent/src/agent/define-agent.ts` — generic over model
  residency `M` and tool tuple `Tools`; intersects the spec with
  `ResidencyConstraint<M, Tools>` so tsc rejects invalid bindings.
- `packages/agent/src/index.ts` — re-export `ResidencyConstraint`.

## Residency type system design

Types live in two places:

1. `agent/src/types/model.ts` — `FuzeModel.residency` is the wide runtime
   union (`'eu' | 'us' | 'multi' | 'unknown'`). The runtime loop check at
   `loop.ts:108` (`def.model.residency !== 'eu'`) still works with the
   wider union.
2. `agent-providers/src/residency.ts` — `ProviderResidency = 'eu' | 'us' | 'multi'`
   (omits `'unknown'` deliberately; provider authors must commit to a
   region) and `ModelProvider<R>` is the typed refinement of `FuzeModel`
   that providers return.

The compile-time constraint is in `agent/src/agent/define-agent.ts`:

```ts
type ToolRequiresEu<T> =
  [T] extends [{ readonly dataClassification: 'personal' }] ? true
  : [T] extends [{ readonly dataClassification: 'special-category' }] ? true
  : false

type AnyToolRequiresEu<Tools extends readonly unknown[]> =
  true extends { [K in keyof Tools]: ToolRequiresEu<Tools[K]> }[number] ? true : false

export type ResidencyConstraint<M extends FuzeModel, Tools extends readonly unknown[]> =
  AnyToolRequiresEu<Tools> extends true
    ? (M['residency'] extends 'eu' ? unknown : ResidencyMismatch)
    : unknown
```

`ResidencyMismatch` is a branded object (private symbol key). `defineAgent`
accepts `spec & ResidencyConstraint<M, Tools>`, so when the constraint
returns `ResidencyMismatch` the spec object literal is unassignable and
tsc emits an error pointing at the spec.

`'multi'` deliberately does NOT satisfy `M['residency'] extends 'eu'`. It's
an explicit, audited escape hatch for providers that legitimately span
regions; the type system forces an audit choice rather than letting `'multi'`
pretend to be EU.

## API surface added

```ts
export type ProviderResidency = 'eu' | 'us' | 'multi'

export interface ModelProvider<R extends ProviderResidency = ProviderResidency>
  extends FuzeModel {
  readonly residency: R
}

export const openAI: (opts: OpenAIOptions) => ModelProvider<'us'>
export function anthropic(opts: AnthropicOptions<'eu'>): ModelProvider<'eu'>
export function anthropic(opts: AnthropicOptions<'us'>): ModelProvider<'us'>

export class OpenAINotInstalledError extends Error
export class AnthropicNotInstalledError extends Error

export type CompatibleProvider<T extends ToolDataClass> = ...
export type RequiresEuResidency<T extends ToolDataClass> = ...
export type ToolsCompatibleWith<R, Tools> = ...
```

The existing `mistralModel`, `scalewayModel`, `ovhModel` now declare
`ModelProvider<'eu'>` instead of the wider `FuzeModel`, so they compose
correctly under the constraint.

## Type-test results (5 cases per the milestone spec)

Verified compile-time behavior:

1. Personal tool bound to `openAI()` — TYPE ERROR (verified via `@ts-expect-error`).
2. Special-category tool bound to `openAI()` — TYPE ERROR.
3. Personal tool bound to `anthropic({ region: 'eu' })` — compiles.
4. Personal tool bound to `anthropic({ region: 'us' })` — TYPE ERROR.
5. Public / business tools bound to any provider — compile.

Bonus case: a mixed `[publicTool, personalTool]` list with a US provider
fails (any single personal-data tool in the list forces EU).

Type-tests are typechecked via `tsconfig.test.json` (the default tsconfig
excludes `test/` to match the existing build contract). The `npm test`
script now runs `tsc -p tsconfig.test.json` before vitest.

## Test counts

- `agent-providers`: 30 tests pass, 2 skipped (live tests gated on env vars).
- `agent`: 82 tests pass, no regressions.
- Workspace `npm run build`: green.

## Ambiguities resolved

- **Where the constraint binds.** The plan suggested the constraint hangs
  off the model's residency type. The minimal change was to make
  `defineAgent` generic over both the model `M` and the tool tuple
  `Tools`, then intersect the spec with a conditional type. `defineAgent`
  is the binding site; nothing else (loop, runtime checks) changed shape.
  The existing runtime check in `validateModelResidency` (`loop.ts`)
  remains as the last-line defense for cases where someone bypasses
  static typing.

- **`defineTool` narrowing.** The plan said tool definitions are out of
  scope. The factory `defineTool` (in `agent`, not `agent-tools`) was
  narrowed so its return types pin the `dataClassification` literal —
  necessary for the constraint to discriminate. No tool implementations
  in `agent-tools` were touched.

- **SDK as optional dependency.** The OpenAI / Anthropic Node SDKs are
  declared as optional `peerDependencies`. Adapters do not require them
  at runtime as long as a `fetchImpl` is supplied (the test path); when
  no `fetchImpl` is given, a `createRequire` probe verifies the SDK is
  installed and throws `*NotInstalledError` otherwise. This matches the
  `JustBashNotInstalledError` precedent in `agent-sandbox-justbash`.

- **`'unknown'` retained on `FuzeModel.residency`.** Widening to
  `'eu' | 'us' | 'multi' | 'unknown'` keeps backwards compat with any
  test or external code that constructed a `FuzeModel` directly. The
  provider-side `ProviderResidency` type drops `'unknown'`; new
  providers should commit to a region.

## Out of scope (deferred to milestone B / future)

- **Span attribute `provider.residency`.** The plan calls for emitting
  this on `model.invoke` spans. That requires touching
  `agent/src/evidence/` which the user excluded. Listed as a milestone B
  follow-up. The runtime carries the residency on every provider
  instance already; surfacing it as a span attribute is one
  emitter-side line.

- **Streaming and `tool.partial` spans** for the new providers — milestone B.

- **Schema versioning** for the broader span surface — milestone B.

- **Vercel AI SDK consolidation.** The plan suggests leaning on Vercel AI
  SDK as a translation layer. This milestone keeps adapters self-contained
  to honor `agent-providers`'s "no extra runtime deps" rule. Revisit when
  cross-provider tool-schema parity matters for workflows (M3).

- **Python SDK parity.** Per the repo-level rule "JS and Python SDKs
  are siblings, not forks", a parallel Python residency-typing pass is
  required before this lands in a release. Tracked as a follow-up.

## Follow-ups

1. Emit `provider.residency` (and `provider.region` where known) on
   `model.invoke` spans in milestone B.
2. Mirror the residency type system in `fuze-python` so the parity test
   passes.
3. When the `openai` SDK is actually installed, evaluate switching the
   OpenAI adapter to call the SDK's `client.chat.completions.create()`
   directly (with custom `fetch`) instead of hand-rolling the request via
   `callOpenAiCompat`. The current shape is testable without the SDK
   present, which is the immediate priority.
4. Consider routing Anthropic via the SDK once installed, for parity
   with future tool-streaming work.
