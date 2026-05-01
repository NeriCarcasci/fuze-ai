# Fuze — Agent Context

Runtime safety + observability middleware for AI agents. EU-first compliance posture. Self-hostable; cloud is an opt-in transport.

## Hard rules (zero tolerance)

1. **No AI attribution anywhere.** No `Co-Authored-By: Claude`, `Generated with Claude Code`, `Authored by AI`, or equivalent — in commits, comments, docs, READMEs, PR descriptions, or code. If you see one, remove it.
2. **JS and Python SDKs are siblings, not forks.** Public API surface, config keys, trace event schema, and wire protocol must match. Touching one without the other is a parity break — see `.context/parity.md`.
3. **No USD / cost / currency as a first-class metric.** Telemetry units are tokens, latency, steps, and wall-clock time. We dropped pricing on purpose; do not reintroduce it. See `.context/product.md`.
4. **No comments explaining *what* code does.** Only *why*, and only when non-obvious. No docstrings restating signatures.
5. **Delete, don't deprecate.** Internal code has no external consumers. Remove dead code outright. No `_old`, no `// TODO: remove after X`, no unused re-exports.

## Commands

JS workspace (root):
```
npm install                      # install all packages (workspaces)
npm run build                    # tsc across all packages
npm run test                     # vitest run across all packages
npm run daemon                   # start local daemon (after build)
```

Per-package JS:
```
npm run -w fuze-ai test          # core package only
npm run -w fuze-ai test:watch    # vitest watch
npm run -w fuze-ai build         # tsc one package
```

Python (`packages/python/` once folded in; currently `../fuze-python`):
```
pip install -e ".[dev]"          # editable install with test deps
pytest                           # full suite (pytest-asyncio auto mode)
pytest tests/test_guard.py -k loop  # focused
```

## Project structure

```
packages/
  core/          # JS SDK — public entry: src/index.ts → guard, createRun, registerTools
  daemon/        # JS local daemon (self-host transport target)
  python/        # Python SDK — public entry: src/fuze_ai/__init__.py (planned move)
.context/        # depth docs — read on demand, not auto-loaded
examples/        # integration smoke tests, treat as docs
data/            # static reference data (model registries, etc.)
```

`src/` and `test/` at the repo root are the **legacy flat layout** and are being deleted. Do not add to them. All work goes in `packages/`.

## Code style — boundaries only

Enforced by tooling (eslint, ruff, prettier, black configs) — don't restate rules here.

- TypeScript: strict mode on, no `any` in public API, no `as` casts to silence the checker (fix the type).
- Python: 3.10+, full type hints on public functions, `from __future__ import annotations` at top of every module.
- Both: no defensive validation at internal boundaries. Validate at the public API entry, then trust internal calls.
- Both: no premature abstraction. Three similar lines is fine; extract on the fourth, not the second.

## Git workflow

- Branches: `main` is the only long-lived branch. Feature work on short-lived branches off main.
- Commit format: imperative mood, ~72 char subject, body wraps at 72. No emoji unless the user asks.
- One commit per logical change. Squash WIP before merge.
- Tests must pass on the commit, not just at the end of the PR.
- Never `--no-verify`. If a hook fails, fix the root cause.

## Boundaries — what NOT to do without asking

- Add a new public API method (must land in JS and Python together).
- Change the trace event schema or transport wire format.
- Add a runtime dependency to either SDK (we keep both lean).
- Reintroduce dropped concepts (USD, cost, currency, pricing).
- Run destructive git operations (force-push, reset --hard, branch delete) without explicit confirmation.

## Where to look next

- `.context/parity.md` — the JS↔Python sync rules. Read before touching public API or trace schema.
- `.context/architecture.md` — invariants: transport layering, public surface, what's load-bearing.
- `.context/code-quality.md` — concrete examples of what passes review and what doesn't.
- `.context/testing.md` — what to test where, the parity test as the highest-value suite.
- `.context/product.md` — EU framing, out-of-scope list, why we made the calls we made.

When in doubt, read the nearest `AGENTS.md` (per-package files override this one for that package's specifics). Then read the relevant `.context/` file. Don't guess.
