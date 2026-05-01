# @fuze-ai/agent-tools

First-party tool catalog built on `@fuze-ai/agent`. Every tool here delegates execution to a `FuzeSandbox` — host-side egress, filesystem, and shell access are the sandbox's job, not the tool's.

## Scope

Five tools shipping in 0.1.0:

- `bashTool` — shell command via sandbox
- `fetchTool` — HTTP GET via sandbox curl, with allowlist
- `readFileTool`, `writeFileTool`, `listFilesTool` — sandbox filesystem ops

All five emit `dataClassification: 'public'` because outputs are logs, response bodies, and file paths. If a caller binds a tool to subject data, that's their classification problem at the agent boundary.

## Hard rules

1. **No host I/O.** Tools must never touch `node:fs`, `node:child_process`, `fetch`, etc. directly. Always go through the injected sandbox.
2. **`threatBoundary` is load-bearing.** It is the static record of what a tool can do. Set `egressDomains`, `readsFilesystem`, `writesFilesystem` to match the actual sandbox call.
3. **Errors return `Retry`, not throws.** Sandbox failures, timeouts, and refusals come back as `Result<TOut, Retryable>` so the loop owns the retry budget.
4. **No retries inside tools.** The agent loop has the only retry counter.

## Layout

```
src/
  bash.ts
  fetch.ts
  read-file.ts
  write-file.ts
  list-files.ts
  index.ts
test/
```
