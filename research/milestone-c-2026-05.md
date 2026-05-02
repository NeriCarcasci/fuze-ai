# Milestone C — webSearchTool + extended fetch verb (2026-05)

Closes the M1 tool catalog: `webSearchTool` plus the sandbox-layer change that unblocks it (HTTP method/headers/body on the synthetic `fetch` verb).

## What shipped

### 1. Extended `fetch` synthetic verb

`JustBashSandbox` now accepts two shapes for the fetch verb. Backward-compatible.

| Shape  | Trigger                                                                           | Behaviour                                                                                    |
| ------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Old    | `command: 'fetch <url>'`, no stdin                                                | GET `<url>`, no headers, no body. Identical to pre-Milestone-C behaviour.                    |
| New    | `command: 'fetch'`, stdin = JSON `{ url, method?, headers?, body? }`              | Method defaults to `'GET'`. Headers default to `{}`. Body is a string the caller serialises. |

Both shapes:
- Honour `allowedFetchPrefixes` — non-allowlisted hosts return `exitCode: 1, stderr: 'fetch denied: <url>'`.
- Fire `onFetch({ url, method, tenant, runId })` exactly once per call.
- Emit the same envelope on stdout: `{ status, body, headers }`.

The sandbox is the egress trust boundary regardless of which shape is used — this preserves the layered model documented in `sandbox-audit-2026-05.md`.

`FakeSandbox` (in `agent-tools/test/fake-sandbox.ts`) was updated symmetrically and now records every fetch call (URL, method, headers, body) on `sandbox.fetchCalls` for test assertions. Fixtures continue to key by URL only — method is ignored for fixture lookup but captured in the call record.

### 2. `webSearchTool`

`packages/agent-tools/src/web-search.ts`. Provider-pluggable: the provider declares the HTTP shape and the response parsing; the tool drives the sandbox call.

```ts
export interface WebSearchProvider {
  readonly name: string
  readonly egressDomains: readonly string[]
  buildRequest(query: string, opts: WebSearchOptions): WebSearchRequest
  parseResponse(envelope: WebSearchResponseEnvelope): readonly WebSearchHit[]
}
```

The provider's `egressDomains` flow into the tool's `threatBoundary.egressDomains`, so a wired-up `webSearchTool` self-declares which hosts it can reach.

Failure modes:
- `Retry('web-search-build-request-failed', ...)` if the provider throws on `buildRequest`.
- `Retry('sandbox-exec-failed', ...)` if the sandbox throws.
- `Retry('web-search-nonzero-exit:<n>', stderr)` on sandbox non-zero exit.
- `Retry('web-search-bad-envelope', ...)` if stdout is not a valid envelope.
- `Retry('web-search-status:<n>', body)` on HTTP non-2xx.
- `Retry('web-search-parse-failed', ...)` if the provider throws on `parseResponse`.

Happy path returns `Ok({ hits, durationMs })`. `dataClassification` is `'public'`.

### 3. Brave + Tavily provider adapters

| Provider | Endpoint                                                | Auth                              | Method | Body                                            |
| -------- | ------------------------------------------------------- | --------------------------------- | ------ | ----------------------------------------------- |
| Brave    | `https://api.search.brave.com/res/v1/web/search`        | `X-Subscription-Token: <apiKey>`  | GET    | none (q/count/safesearch/country in querystring) |
| Tavily   | `https://api.tavily.com/search`                         | `api_key` field in JSON body      | POST   | `{ api_key, query, max_results, country, include_answer: false }` |

Both are pure functions — no HTTP, no I/O. The tool routes the HTTP through the sandbox, so the AGENTS.md "no host I/O in tools" rule is preserved.

One-line examples:
- `braveProvider({ apiKey: process.env.BRAVE_API_KEY ?? '' })`
- `tavilyProvider({ apiKey: process.env.TAVILY_API_KEY ?? '' })`

## Files changed

| File                                                                           | Status  | Lines |
| ------------------------------------------------------------------------------ | ------- | ----- |
| `packages/agent-sandbox-justbash/src/sandbox.ts`                               | Edit    | +63 / -16 |
| `packages/agent-sandbox-justbash/test/verb-translation.test.ts`                | Edit    | +99   |
| `packages/agent-tools/src/web-search.ts`                                       | New     | 124   |
| `packages/agent-tools/src/web-search/types.ts`                                 | New     | 27    |
| `packages/agent-tools/src/web-search/providers/brave.ts`                       | New     | 64    |
| `packages/agent-tools/src/web-search/providers/tavily.ts`                      | New     | 60    |
| `packages/agent-tools/src/index.ts`                                            | Edit    | +13   |
| `packages/agent-tools/test/fake-sandbox.ts`                                    | Edit    | +47   |
| `packages/agent-tools/test/web-search.test.ts`                                 | New     | 117   |
| `packages/agent-tools/test/web-search-brave.test.ts`                           | New     | 58    |
| `packages/agent-tools/test/web-search-tavily.test.ts`                          | New     | 56    |
| `fuze-web/src/app/product/agent/page.tsx`                                      | Edit    | +12   |

## Test results

| Package                       | Tests passed |
| ----------------------------- | ------------ |
| `@fuze-ai/agent-tools`        | 62 / 62      |
| `@fuze-ai/agent-sandbox-justbash` | 42 / 42 (5 live tests skipped, gated by `CI_LIVE_JUSTBASH=1`) |
| `@fuze-ai/agent`              | 82 / 82      |

Workspace `npm run build` is green; `fuze-web npm run build` is green.

## Decisions and notes

- **Egress trust boundary location.** The sandbox enforces `allowedFetchPrefixes` for both old and new fetch shapes. The tool also inherits its provider's `egressDomains` into the threatBoundary, but the sandbox is the only place that *enforces* the egress allowlist at runtime. This matches the pre-existing posture for `fetchTool`.
- **Backward compat.** The `fetchTool` (single-URL GET) was deliberately not migrated — milestone says "extend or leave alone, pick whichever is cleaner." Leaving it on the legacy verb keeps that test surface stable. New tools (here, `webSearchTool`) use the new shape.
- **Fixture keying.** `FakeSandbox` continues to key fixtures by URL string only. Method/headers/body are recorded on `fetchCalls` so tests can assert request shape independently of fixture lookup.
- **Provider SDK probes.** Brave and Tavily are simple HTTP APIs — no peer SDKs to install — so the M2 `*NotInstalledError` pattern was not needed here.

## Deferred / not done

Nothing was deferred. Acceptance criteria for the M1 `webSearchTool` line item are all met: provider-pluggable, route through sandbox, threatBoundary derived from provider, no host-fetch in tool/provider code, key never leaks into spans (it travels in `headers` / body, which is sandbox stdin — not a tool input span field).
