import { describe, it, expect } from 'vitest'
import { grepTool } from '../src/grep.js'
import { FakeSandbox, makeTestCtx, TEST_RETENTION } from './fake-sandbox.js'

const seed = (sandbox: FakeSandbox): void => {
  sandbox.fs.set('/work/a.ts', 'const a = 1\nconst b = 2\nconst foo = 3')
  sandbox.fs.set('/work/b.ts', 'function foo() { return 42 }\nfunction bar() { return 7 }')
  sandbox.fs.set('/work/notes.md', '# Foo notes\nfoo bar baz')
  sandbox.fs.set('/other/x.ts', 'foo unrelated')
}

describe('grepTool', () => {
  it('returns matches with path, line, and text for a literal pattern', async () => {
    const sandbox = new FakeSandbox()
    seed(sandbox)
    const tool = grepTool({ sandbox, retention: TEST_RETENTION })
    const result = await tool.run({ pattern: 'foo', path: '/work' }, makeTestCtx())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const matches = result.value.matches
    expect(matches.length).toBeGreaterThan(0)
    expect(matches.every((m) => m.path.startsWith('/work'))).toBe(true)
    const aTsMatch = matches.find((m) => m.path === '/work/a.ts')
    expect(aTsMatch?.line).toBe(3)
    expect(aTsMatch?.text).toBe('const foo = 3')
    expect(result.value.truncated).toBe(false)
  })

  it('respects caseInsensitive', async () => {
    const sandbox = new FakeSandbox()
    seed(sandbox)
    const tool = grepTool({ sandbox, retention: TEST_RETENTION })
    const sensitive = await tool.run(
      { pattern: 'Foo', path: '/work' },
      makeTestCtx(),
    )
    const insensitive = await tool.run(
      { pattern: 'Foo', path: '/work', caseInsensitive: true },
      makeTestCtx(),
    )
    expect(sensitive.ok).toBe(true)
    expect(insensitive.ok).toBe(true)
    if (!sensitive.ok || !insensitive.ok) return
    expect(insensitive.value.matches.length).toBeGreaterThan(sensitive.value.matches.length)
  })

  it('limits matches to path scope', async () => {
    const sandbox = new FakeSandbox()
    seed(sandbox)
    const tool = grepTool({ sandbox, retention: TEST_RETENTION })
    const result = await tool.run({ pattern: 'foo', path: '/work' }, makeTestCtx())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.matches.find((m) => m.path === '/other/x.ts')).toBeUndefined()
  })

  it('honors maxMatches and reports truncated=true when capped', async () => {
    const sandbox = new FakeSandbox()
    seed(sandbox)
    const tool = grepTool({ sandbox, retention: TEST_RETENTION })
    const result = await tool.run(
      { pattern: 'foo', path: '/work', maxMatches: 1 },
      makeTestCtx(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.matches.length).toBe(1)
    expect(result.value.truncated).toBe(true)
  })

  it('returns Retry on an invalid regex', async () => {
    const sandbox = new FakeSandbox()
    seed(sandbox)
    const tool = grepTool({ sandbox, retention: TEST_RETENTION })
    const result = await tool.run({ pattern: '[unterminated', path: '/work' }, makeTestCtx())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as { reason: string }).reason).toContain('grep-nonzero-exit')
  })

  it('declares a read-only filesystem threatBoundary and public dataClassification', () => {
    const sandbox = new FakeSandbox()
    const tool = grepTool({ sandbox, retention: TEST_RETENTION })
    expect(tool.dataClassification).toBe('public')
    expect(tool.threatBoundary.readsFilesystem).toBe(true)
    expect(tool.threatBoundary.writesFilesystem).toBe(false)
    expect(tool.threatBoundary.egressDomains).toBe('none')
  })

  it('returns Retry when the sandbox throws', async () => {
    const sandbox = new FakeSandbox()
    const exploding = {
      ...sandbox,
      tier: sandbox.tier,
      threatBoundary: sandbox.threatBoundary,
      exec: async () => {
        throw new Error('sandbox down')
      },
    }
    const tool = grepTool({ sandbox: exploding, retention: TEST_RETENTION })
    const result = await tool.run({ pattern: 'foo', path: '/work' }, makeTestCtx())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as { retryable: true }).retryable).toBe(true)
    expect((result.error as { reason: string }).reason).toBe('sandbox-exec-failed')
  })

  it('returns Retry when the sandbox stdout is not valid JSON', async () => {
    const sandbox = {
      tier: 'in-process' as const,
      threatBoundary: {
        trustedCallers: ['agent-loop'],
        observesSecrets: false,
        egressDomains: 'none' as const,
        readsFilesystem: true,
        writesFilesystem: false,
      },
      exec: async () => ({
        stdout: 'not-json',
        stderr: '',
        exitCode: 0,
        durationMs: 1,
        tier: 'in-process' as const,
        truncated: false,
      }),
    }
    const tool = grepTool({ sandbox, retention: TEST_RETENTION })
    const result = await tool.run({ pattern: 'foo', path: '/work' }, makeTestCtx())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as { reason: string }).reason).toBe('grep-bad-envelope')
  })
})
