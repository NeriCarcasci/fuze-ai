# Testing strategy

Tests are documentation that runs. The goal is not coverage percentage; it's confidence that the next change won't silently break the contract.

## Where tests live

- JS: `packages/<pkg>/test/*.test.ts` — vitest. Entry: `npm run -w <pkg> test`.
- Python: `packages/python/tests/test_*.py` — pytest with `asyncio_mode = "auto"`. Entry: `pytest`.
- Cross-language parity tests: `tests/parity/` (planned). These exist precisely because unit tests in either language cannot catch JS↔Python drift.

## What level of test for what change

**Unit test** when:
- The function has non-trivial logic with a clear input → output mapping (loop detector, hash chain, config merge).
- A bug fix lands. The test reproduces the bug, then the fix makes it pass. Test goes in the PR with the fix.

**Integration test** when:
- The change crosses a module boundary that matters to the user (guard wrapper actually invokes trace recorder, transport actually sends bytes).
- A new public API method is added.

**Parity test** when:
- The change touches public API, config keys, trace event schema, wire format, or error classes. See `.context/parity.md`.

**No test** when:
- The change is a pure rename or refactor that the type system already validates.
- The change is doc-only.
- The "test" would mock everything and prove nothing.

## What NOT to mock

- The trace recorder. Use the real one with a temp file — it's fast and catches schema bugs that mocks never will.
- The hash chain. Same reason. Verifying chain integrity is the entire point.
- Time, when feasible. Use a controllable clock (vitest fake timers, `freezegun`) instead of mocking the clock at the call site.

## What IS fine to mock

- The transport. Tests should not hit a real daemon socket or real cloud endpoint. Use the noop transport or a fake that captures payloads.
- LLM provider responses. We don't test their APIs.
- File system writes outside of trace output (rare).

## The single most valuable test in this repo

A test that takes the same agent run, executes it under JS and under Python, and asserts the trace event sequences are byte-identical (after JSON normalization). Until that test exists, every public API PR carries unverified parity risk. Consider this the highest-priority gap.

## Test naming

Describe the *behavior*, not the *function*.

**Bad:** `test_guard_function`
**Good:** `test_guard_aborts_run_when_token_budget_exceeded`

A test name should make the failure message in CI tell you what regressed without opening the file.

## Flakes

A flaky test is a broken test. Fix the root cause or delete it. Do not retry-loop or `@pytest.mark.flaky`. Common causes:

- Timing assumptions (use deterministic clocks).
- Order dependence between tests (use isolated fixtures).
- Shared global state (config, registries — reset in `beforeEach` / fixture teardown).

The trace recorder uses module-level state in some places; make sure tests reset it explicitly.

## Running tests in parallel

JS: vitest runs in parallel by default.
Python: pytest runs serially. If a test relies on global config or recorder state, it must reset that state or the next test will inherit it.
