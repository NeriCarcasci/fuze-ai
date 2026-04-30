# `fuze-ai` (Python SDK)

Public Python package. Published to PyPI as `fuze-ai`. The other half of this is `packages/core/` (JS) — see [../../.context/parity.md](../../.context/parity.md) before changing public surface.

## Commands

```
cd packages/python
pip install -e ".[dev]"      # editable install with test deps
pytest                       # full suite (asyncio_mode = auto)
pytest tests/test_guard.py -k loop   # focused
pip install -e ".[langgraph,crewai,services]"   # framework adapters + services
```

Hatchling is the build backend. `python -m build` produces wheels.

## Public entry

`src/fuze_ai/__init__.py` defines `__all__` — that is the public surface. Anything starting with `_` or not in `__all__` is internal.

Current public surface (must mirror `packages/core/src/index.ts`):

- `guard` — decorator (`@guard` or `@guard(timeout=...)`); also accepts a callable for HOF use
- `create_run(config?)` — returns `RunContext`
- `configure(config)` / `reset_config()`
- `register_tools(project_id, tools)`
- `extract_usage_from_result(...)`
- `verify_chain(...)`
- Errors: `LoopDetected`, `GuardTimeout`, `ResourceLimitExceeded`, `FuzeError`
- Types: `GuardOptions`, `FuzeConfig`, `ResourceLimits`, `ResourceUsageStatus`

## Conventions specific to this package

- Python 3.10+ only. `from __future__ import annotations` at the top of every module.
- Full type hints on public functions. Internal helpers may skip them.
- Sync and async both supported via inspection of the wrapped callable. Don't force one or the other.
- Zero required runtime dependencies. Optional deps are gated behind extras (`[services]`, `[langgraph]`, `[crewai]`).

## Adapters

`src/fuze_ai/adapters/` holds optional integrations with agent frameworks (`langgraph`, `crewai`, `raw`). Each adapter:

- Imports the framework lazily (inside the function, not at module top), so the SDK works without it installed.
- Is gated by an extra in `pyproject.toml`.
- Has its own test file under `tests/`.

If you add an adapter, also add the extra to `pyproject.toml` and a test that uses the real framework (skipped if not installed).

## Don't

- Don't add a required runtime dep. Use an extra.
- Don't change a public function signature without the matching change in `packages/core/`.
- Don't use snake_case config keys assuming the JS SDK accepts them — see `.context/parity.md` for the known config-key divergence.
