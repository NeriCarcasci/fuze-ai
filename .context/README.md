# `.context/` — depth docs for agents

`AGENTS.md` (root) is the always-loaded summary. The files here are loaded on demand when relevant.

| File | When to read |
|------|--------------|
| [parity.md](parity.md) | Touching public API, config, trace schema, or wire format. The single most load-bearing rule in this repo. |
| [architecture.md](architecture.md) | Designing a new module or refactoring across boundaries. Invariants and out-of-scope items. |
| [code-quality.md](code-quality.md) | Writing or reviewing code. Concrete examples of what passes and what doesn't. |
| [testing.md](testing.md) | Adding tests, deciding test level, or debugging flakes. |
| [product.md](product.md) | Scoping a new feature, weighing a request, or wondering "why don't we just add X?" |

## Maintenance rules

- These files are committed source. Update them in the same PR that changes the rule, not later.
- Keep each file under ~200 lines. If a file is growing, split by topic.
- No file paths or symbol names in prose unless they're the topic. They rot. Use roles ("the transport layer") instead.
- No restating what eslint, ruff, prettier, or black already enforce.
- No restating generic engineering principles. Agents already know them.

## How to know a `.context/` file has gone stale

- It references a file path that no longer exists (`grep` for the path; if zero hits, the file lied).
- It restates a rule that's now in tooling config (move it out).
- It contradicts current behavior (rewrite it; the codebase wins).
- It's longer than 200 lines (split it).
