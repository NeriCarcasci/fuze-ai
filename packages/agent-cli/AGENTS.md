# @fuze-ai/agent-cli

`fuze` — operator/auditor command line. Talks to a Fuze Agent API server over HTTP. Designed for `npx @fuze-ai/agent-cli`.

## Scope

Subcommands:

- `fuze health` — reachability check on the API server.
- `fuze audit query` — fetch evidence spans by subject HMAC and tenant.
- `fuze audit replay <runId>` — walk the chain step-by-step (interactive).
- `fuze audit verify <runId>` — verify hash chain and transparency anchor.
- `fuze approve <runId>` — submit an oversight decision (approve/reject/halt/override).
- `fuze dpia <agent.json>` — generate a DPIA from an agent definition file.
- `fuze annex-iv <agent.json> --records <file.jsonl>` — generate an Annex IV report.

## Hard rules

- **No interactive frameworks.** No `inquirer`, no `yargs`, no `commander`. Argument parsing uses `node:util.parseArgs`. Prompts (only `audit replay` has any) use the raw `node:readline` API.
- **No new runtime deps.** Stick to Node 20+ stdlib. The CLI must work cleanly under `npx` with zero install penalty beyond workspace siblings.
- **Public surface is the `ApiClient`.** Embedders import from `@fuze-ai/agent-cli` to reuse the typed client; the CLI binary is just a thin dispatcher.
- **Output formats:** human-readable tabular default, `--json` flag for structured output (for piping into auditor pipelines).
- **Exit codes:** `0` success, `1` user error, `2` server error.
