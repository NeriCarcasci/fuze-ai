# Parity test harness

Cross-language parity tests for the Fuze JS and Python SDKs. The harness runs
the same logical scripted agent work in both languages, captures the trace event
JSON Lines from each, normalises non-deterministic fields, and asserts the two
sequences are byte-equal after normalisation.

This is the load-bearing artifact that gates parity claims for the trace event
schema. Until it stays green, public-API PRs carry unverified parity risk —
see `.context/parity.md` and `.context/testing.md`.

## How to run

Prereqs:

- JS SDK built: `npm run -w fuze-ai build` from the repo root.
- Python SDK installed editable: `pip install -e ".[dev]"` in `packages/python/`.
- Node 20+, Python 3.10+.

Run all scenarios:

```
cd tests/parity
node compare.mjs --all
```

Run one:

```
node compare.mjs scenarios/01-basic-guard
```

Exit 0 on full match, 1 on any mismatch (with a per-line diff written to stderr).

## How to add a scenario

1. `mkdir scenarios/NN-name/`.
2. Drop in `scenario.json` describing the steps.
3. Add `js-runner.mjs` and `python-runner.py` that import the SDK, execute the
   scenario via the SDK's public API, and print the trace JSONL to stdout.
4. Run `node compare.mjs scenarios/NN-name`. Iterate until green.

The scenario.json schema is intentionally minimal:

```json
{
  "name": "01-basic-guard",
  "description": "...",
  "steps": [
    { "tool": "echo", "args": ["hello"], "tokensIn": 10, "tokensOut": 5 }
  ]
}
```

Runners construct a function named `tool` that returns a payload shaped like an
OpenAI response (`{ usage: { prompt_tokens, completion_tokens } }`) so the
SDKs' `extractUsageFromResult` populates the declared token counts.

## Normalisation

`normalize.mjs` rewrites each JSONL record before comparison:

- UUID values → `<uuid_run_id:N>`, `<uuid_step_id:N>`, `<uuid_event_id:N>`,
  numbered per kind in order of first appearance.
- ISO 8601 timestamps in `timestamp`, `started_at`, `ended_at` → flat `<ts>`
  (JS uses ms resolution, Python us — counter-based numbering is too brittle).
- `latency_ms` → `<duration>`.
- `hash`, `prev_hash` (64-hex) → `<hash:N>`.
- `signature` (64-hex) → `<sig:N>`.
- `args_hash` → `<args_hash:N>` (see "Known parity bugs" below).
- All keys re-emitted in sorted order.

`args_hash` is **supposed** to be deterministic and identical across languages
for the same args, and the parity contract verifies that "same args -> same
hash" within each stream. The cross-language equivalence is a separate, real
bug (see below) — until it lands, normalisation maps each unique value to a
per-stream id so structural dedup parity still holds.

## Known parity bugs surfaced by this harness

These were discovered while building the harness. None are papered over by the
trace-schema contract — they are explicitly tracked and currently bridged in
`normalize.mjs` with an inline comment per bridge.

1. **Trace key casing.** JS emits camelCase keys (`recordType`, `stepId`,
   `argsHash`, `prevHash`, `tokensIn`, …); Python emits snake_case
   (`record_type`, `step_id`, `args_hash`, `prev_hash`, `tokens_in`, …).
   `.context/parity.md` mandates byte-identical schemas. The normaliser converts
   the JS side to snake_case as a temporary bridge.

2. **`args_hash` divergence.** Both SDKs sha256 a JSON serialisation of args
   then take the first 16 hex chars, but the serialisations differ:
   JS = `JSON.stringify(args)` (positional only),
   Python = `json.dumps({"args": args, "kwargs": kwargs}, sort_keys=True, default=...)`
   (positional + kwargs, with a typed-default coercion). For the same inputs
   they produce different hashes, breaking the only cross-language dedup primitive.

3. **`config` payload in `run_start`.** JS dumps the resolved options object
   with camelCase keys and omits null-valued fields; Python dumps with
   snake_case keys and includes `compensate: null`, `usage_extractor: null`.
   The normaliser drops the entire `config` object — it is process-specific
   (contains the absolute trace_output path) and not part of the load-bearing
   schema. A separate decision is needed on whether `config` should be in the
   trace at all and, if so, what its shape is.

4. **`error` field shape on success.** JS omits `error` from `step` records
   when there was no error; Python emits `"error": null`. Bridged by dropping
   `error: null`.

5. **Timestamp resolution.** JS uses `Date.now()` (ms); Python uses
   `datetime.now(timezone.utc)` (us). Not a schema bug per se but it makes
   timestamp-equality counters useless across languages — see the flat `<ts>`
   handling above.

The right resolution for items 1, 3, 4 is to pick one canonical shape (snake_case
matches the `fuze.toml` canonical convention) and update the JS recorder.
Item 2 is a small, contained fix in `hashArgs` / `_hash_args`.
