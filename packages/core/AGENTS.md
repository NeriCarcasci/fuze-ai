# `fuze-ai` (JS SDK)

Public TypeScript SDK. Published to npm as `fuze-ai`. The other half of this is `packages/python/` — see [../../.context/parity.md](../../.context/parity.md) before changing public surface.

## Commands

```
npm install                  # at repo root, installs all workspaces
npm run -w fuze-ai build     # tsc → dist/
npm run -w fuze-ai test      # vitest run
npm run -w fuze-ai test:watch
```

Tests live in `test/`, source in `src/`, build output in `dist/` (gitignored).

## Public entry

`src/index.ts` re-exports the public surface. Anything not exported here is internal — agents may not import from `src/internal/` or deep paths from outside the package.

Current public surface (must mirror `packages/python/src/fuze_ai/__init__.py`):

- `guard(fn, options?)` — HOF wrapper
- `createRun(agentId?, options?)` — returns run context
- `configure(config)` / `resetConfig()`
- `registerTools(tools)`
- `extractUsageFromResult(...)`
- `verifyChain(...)`
- Errors: `LoopDetected`, `GuardTimeout`, `ResourceLimitExceeded`, `FuzeError`
- Types: `GuardOptions`, `FuzeConfig`, `RunContext`, `ResourceLimits`, `ResourceUsageStatus`, `ExtractedUsage`

## Conventions specific to this package

- Strict TypeScript, no `any` in public types, no escape-hatch `as` casts.
- ESM only (`"type": "module"`). Imports use `.js` extension even for `.ts` source files (NodeNext convention).
- One runtime dependency total (`@iarna/toml`). Adding more requires explicit justification — the SDK stays lean.
- Node 20+ only. Uses `node:crypto` `randomUUID` directly, no polyfill.

## Don't

- Don't add a `dist/` to git. It's a build artifact. (`.gitignore` already covers it.)
- Don't import from `packages/daemon`. Core has zero dependency on daemon. The relationship is the other way.
- Don't change a public function signature without the matching change in `packages/python/`.
