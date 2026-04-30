# Code quality — concrete examples

This file exists because generic advice ("write clean code") doesn't change behavior. The rules below are what actually gets flagged in review.

## No AI attribution. Anywhere.

**Never write:**
```
// Generated with Claude Code
// Co-Authored-By: Claude
# AI-assisted implementation
```

**Never include in commit messages:**
```
Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
🤖 Generated with [Claude Code]
```

If you find one in existing code or history, remove it. Past commit history was force-rewritten on 2026-04-30 to strip these — keep it that way.

## No comments that explain *what*

**Bad:**
```ts
// Increment the step counter
context.stepNumber++

// Loop through each tool
for (const tool of tools) { ... }
```

**Good (only when *why* is non-obvious):**
```ts
// Daemon may be restarting; treat connect failure as soft and fall back to noop.
catch (err) { ... }
```

If removing the comment would not confuse a future reader, the comment shouldn't exist. Identifier names already explain *what*. Save comments for hidden constraints, subtle invariants, and workarounds.

## No defensive code at internal boundaries

**Bad:**
```python
def _build_context(resolved, service):
    if resolved is None:
        raise ValueError("resolved must not be None")
    if not isinstance(service, FuzeService):
        raise TypeError(...)
    ...
```

`_build_context` is internal. Its callers are in this codebase. If they pass `None`, that's a bug we want to surface as a crash, not a polite error. Validate at the public API entry (`guard`, `createRun`), then trust the type system.

**Good — validate at the entrance:**
```python
def guard(_fn=None, /, **options):
    # Validate options here, where users actually pass them
    ...
```

## Delete, don't deprecate

**Bad:**
```ts
// @deprecated — use newName instead, will be removed in v0.2
export const oldName = newName
```

We have no external API consumers to migrate. Internal deprecation is just dead code wearing a costume. Delete it.

**Good:** Rename the symbol, fix every caller, delete the old name. One commit.

## No premature abstraction

Three similar lines is fine. Extract on the fourth, not the second. A wrapper that exists to "future-proof" something we'll never need is technical debt, not foresight.

**Bad:** Adding a `TransportFactory` interface for a single transport implementation "in case we add more later."

**Good:** Hardcode the one we use. When we genuinely add a second, refactor — at that point you actually know what the abstraction needs.

## No backwards-compat shims for things that aren't backwards-compatible

If you removed a function, don't leave behind a re-export that calls the new function with reshaped arguments. Either it's still public (full implementation) or it's gone (deleted everywhere, including tests, examples, and docs).

## Trust the type system

**Bad (TypeScript):**
```ts
function guard(fn: GuardableFn, opts?: GuardOptions): GuardableFn {
    if (typeof fn !== 'function') throw new Error(...)
    if (opts && typeof opts !== 'object') throw new Error(...)
    ...
}
```

The type signature already tells the caller what's allowed. Adding runtime checks for things the type system enforces just bloats the function. Reserve runtime checks for things the type system genuinely can't verify (parsed JSON, env vars, config files).

## Public API ergonomics

Public functions optimize for the common case being one line. Rare edge cases get parameters with sensible defaults, not separate functions.

**Good:**
```ts
guard(myFn)                                  // common
guard(myFn, { timeout: 5000 })               // tuned
guard(myFn, { timeout: 5000, dryRun: true }) // edge
```

## Errors that say what to do

**Bad:** `throw new Error("Invalid config")`
**Good:** `throw new FuzeError("config.cloud.apiKey must be set when config.cloud.endpoint is provided. Set FUZE_API_KEY or remove cloud.endpoint.")`

Error messages are documentation that fires only when needed. Make them carry their weight.

## Don't ship dead `dist/`

`dist/` directories are build artifacts. They live in `.gitignore` and are produced by `npm run build`. Don't commit them. If you see them committed, that's a regression — `.gitignore` was bypassed somehow.
