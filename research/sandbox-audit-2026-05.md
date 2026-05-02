# Sandbox audit — synthetic verbs vs. JustBashSandbox (2026-05)

## Verdict

**BROKEN → FIXED.** Before this audit the SDK was shipping tools whose unit tests passed only against `FakeSandbox`. Wired through `JustBashSandbox` + `RealBashFactory` (the real production path) every synthetic verb except `bash`/`echo` failed.

A verb-translation layer has been added in `packages/agent-sandbox-justbash/src/sandbox.ts` and the build is green with new integration tests covering each verb against `RealBashFactory`.

## Evidence: smoke test against the unmodified sandbox

Sequence of `sandbox.exec({ command, stdin })` calls against `JustBashSandbox` instantiated with `new RealBashFactory()` (single tenant, single run):

```
[echo]       exit=0   stdout="hello\n"
[write_file] exit=127 stderr="bash: write_file: command not found"
[read_file]  exit=127 stderr="bash: read_file: command not found"
[list_files] exit=127 stderr="bash: list_files: command not found"
[grep]       exit=2   stderr="grep: missing pattern"          # collides with unix grep
[glob]       exit=127 stderr="bash: glob: command not found"
[edit]       exit=127 stderr="bash: edit: command not found"
[fetch]      exit=127 stderr="bash: fetch: command not found"
```

`grep` is the worst case: just-bash *does* ship a real `grep` builtin, so the synthetic verb does not exit 127 — it executes the unix grep, gets a JSON document on stdin, and reports `missing pattern`. That would have produced confusing failures in production rather than a clean 127.

## What just-bash actually ships (v2.14.2)

Builtins enumerated from `node_modules/just-bash/README.md`:

- File ops: `cat`, `cp`, `file`, `ln`, `ls`, `mkdir`, `mv`, `readlink`, `rm`, `rmdir`, `split`, `stat`, `touch`, `tree`
- Text: `awk`, `base64`, `column`, `comm`, `cut`, `diff`, `expand`, `fold`, `grep` / `egrep` / `fgrep`, `head`, `join`, `md5sum`, `nl`, `od`, `paste`, `printf`, `rev`, `rg`, `sed`, `sha1sum`, `sha256sum`, `sort`, `strings`, `tac`, `tail`, `tr`, `unexpand`, `uniq`, `wc`, `xargs`
- Data: `jq`, `sqlite3`, `xan`, `yq`
- Optional runtimes (off by default): `js-exec`, `python3` / `python`
- Compression: `gzip` / `gunzip` / `zcat`, `tar`
- Nav/env: `basename`, `cd`, `dirname`, `du`, `echo`, `env`, `export`, `find`, `hostname`, `printenv`, `pwd`, `tee`
- Shell utils: `alias`, `bash`, `chmod`, `clear`, `date`, `expr`, `false`, `help`, `history`, `seq`, `sh`, `sleep`, `time`, `timeout`, `true`, `unalias`, `which`, `whoami`
- Network (only when `network:` is configured upstream): `curl`, `html-to-markdown`

There is **no** `read_file` / `write_file` / `list_files` / `glob` / `edit` / `fetch` builtin. just-bash does expose a `customCommands` extension API via `defineCommand`, but `RealBashFactory` does not pass `customCommands` to the upstream `Bash` constructor — it forwards only `cwd`, `env`, `files`, `logger`, `fetch`. So nothing is interpreting the synthetic verbs at the just-bash layer either.

`curl` requires upstream `network:` configuration which `RealBashFactory` also does not set, so even if the `fetch` verb had been translated to `curl …`, network access would have been denied at the just-bash boundary. The host-side `wrappedFetch` injected via `BashCreateOptions.fetch` is only reachable from inside `js-exec` / `python3` (which need their own opt-ins) — it is never invoked by a bare `fetch` synthetic verb.

## What the existing tests cover, and what they don't

`packages/agent-sandbox-justbash/test/`:

- `sandbox.test.ts` — 21 tests. All exercise the sandbox against `FakeBashFactory` (a JS stub local to this package, not the agent-tools `FakeSandbox`). Commands are bash-flavoured (`echo`, `cat`, `printenv`, `read`, `write`) — none of them test the agent-tools synthetic verbs.
- `justbash-live.test.ts` — 5 tests, gated by `CI_LIVE_JUSTBASH=1`, so they did not run in the default suite. Cover `echo`, `cat` with stdin, a pipe, the watchdog, and `onLog`. No synthetic verbs.
- `real-factory-shape.test.ts` — 4 tests. Type-shape and missing-dependency error path only, no execution.
- `adapt-logger.test.ts` — 3 tests. Pure logger plumbing, no execution.

The agent-tools tests in `packages/agent-tools/test/*.test.ts` exercise the synthetic verbs only against the `FakeSandbox` in `packages/agent-tools/test/fake-sandbox.ts`, which interprets them in JS. Nothing in the repo wired the synthetic verbs through to `RealBashFactory` until this audit.

## Fix: verb-translation layer in `JustBashSandbox.exec()`

`src/sandbox.ts` was rewritten so that `exec()` first dispatches the input through a `dispatch()` step that recognises the synthetic verbs and either translates them to real shell sequences or computes the result in JS. The layered design is preserved: tools still send `{ command, stdin }`, the sandbox is still the only place that touches just-bash, and `bash.exec()` only ever sees real shell commands.

Translations:

| Verb                     | Translation                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `read_file <path>`       | `cat -- '<path>'`                                                                                                                            |
| `write_file <path>`      | `cat > '<path>'` with stdin piped through; stdout post-processed to `String(Buffer.byteLength(stdin, 'utf8'))`                               |
| `list_files <path>`      | `ls -1 -- '<path>'`; trailing blank lines stripped                                                                                           |
| `grep` (JSON stdin)      | `find '<path>' -type f` to enumerate, `cat` per file, regex + envelope built in JS to match `FakeSandbox` semantics exactly                  |
| `glob` (JSON stdin)      | `find` to enumerate, JS glob matcher (same source as `FakeSandbox`) builds the envelope                                                      |
| `edit` (JSON stdin)      | `cat` to read, JS does the substitution + occurrence check, `cat > path` with the new content, envelope built in JS                         |
| `fetch <url>`            | Direct host `fetch()` with the same allow-list logic as `buildFetch`, JSON envelope built in JS. (`curl` path was unavailable — see above.) |

Path quoting goes through a single-quote escaper (`shQuote`) so paths with spaces or special characters survive the shell hop. Unrecognised commands fall through to `bash.exec()` unchanged, preserving the "tools that pass arbitrary bash" contract used by `bashTool` and the existing `sandbox.test.ts` suite.

### Files changed

| File                                                            | Change          | Lines |
| --------------------------------------------------------------- | --------------- | ----- |
| `packages/agent-sandbox-justbash/src/sandbox.ts`                | Rewritten       | 487   |
| `packages/agent-sandbox-justbash/test/verb-translation.test.ts` | New, real-factory integration tests for every synthetic verb | 185   |

### Test results

```
Test Files  4 passed | 1 skipped (5)
Tests       38 passed | 5 skipped (43)
```

Breakdown:

- `adapt-logger.test.ts`: 3 passed
- `real-factory-shape.test.ts`: 4 passed
- `sandbox.test.ts`: 21 passed (regression — the existing fake-factory suite still passes after the rewrite)
- `verb-translation.test.ts`: 10 passed (new; runs against `RealBashFactory`)
- `justbash-live.test.ts`: 5 skipped (still gated by `CI_LIVE_JUSTBASH=1`)

## Follow-up risks and gaps

1. **Performance of `grep` / `glob`.** The current implementation runs one `find` plus N `cat`s per `grep`. For a hundred-file tree that's 100+ bash invocations. Acceptable for correctness now, but if the agent loop starts hammering `grep`, push the work into a single bash invocation (e.g., `grep -rn -- 'pattern' '<path>'`) and parse the textual output. Keep the JS path as the slow-but-correct reference.
2. **`fetch` bypasses the upstream sandbox.** Today the `fetch` verb does its HTTP call from the host process and respects `allowedFetchPrefixes` on the way in. This is the same security posture the original `buildFetch` had for `js-exec`, but it does mean the actual TCP connection is host-process, not sandbox-process. The threat-boundary already records this (`egressDomains`) and tools restrict by hostname allow-list, so it matches the documented contract — flagging it explicitly because the layered "everything goes through bash" mental model no longer literally applies for `fetch`.
3. **`onFetch` semantics.** The new `runFetch` fires `onFetch` once per `fetch` verb invocation. The pre-existing `buildFetch` path also fires `onFetch` if anything inside `js-exec` / `python3` calls the wrapped fetch. Both paths are observable; just be aware that a single agent step that uses both could log two `onFetch` entries.
4. **`list_files` recursion semantics.** Current translation is `ls -1 -- <path>`, mirroring the FakeSandbox top-level-only semantics for `list_files <dir>`. Tools that want recursive listing should use `glob` or `find` via `bashTool`. This is consistent with the existing tool contract — flagging only because the synthetic verb name "list_files" could imply recursion to a future contributor.
5. **`grep` `truncated` accounting.** A `grep` that hits `maxMatches` mid-file stops the inner loop but only after appending the over-budget match would have been considered. Truncated matches array size is exactly `max`, matching FakeSandbox. Behaviour locked by the `truncated` test in `verb-translation.test.ts`; please don't relax that without updating both implementations.
6. **The `agent-tools` synthetic-verb contract is undocumented in code.** AGENTS.md mentions JSON-stdin verbs at a high level, but the exact stderr strings that `editTool` keys off (`edit-no-such-file:`, `edit-occurrence-mismatch:expected=N:actual=M`) are only encoded in `FakeSandbox` and now `JustBashSandbox`. If a future sandbox adapter is added (e.g., `agent-sandbox-vercel`), those literal strings need to be re-implemented identically. Worth extracting a small shared spec or constant table when the next adapter lands.
