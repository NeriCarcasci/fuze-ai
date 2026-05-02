import { describe, it, expect } from 'vitest'
import { editTool } from '../src/edit.js'
import { FakeSandbox, makeTestCtx, TEST_RETENTION } from './fake-sandbox.js'

describe('editTool', () => {
  it('replaces the single matching occurrence and reports bytesWritten', async () => {
    const sandbox = new FakeSandbox()
    sandbox.fs.set('/work/a.ts', 'const a = 1\nconst b = 2\n')
    const tool = editTool({ sandbox, retention: TEST_RETENTION })
    const result = await tool.run(
      {
        path: '/work/a.ts',
        oldString: 'const a = 1',
        newString: 'const a = 99',
      },
      makeTestCtx(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.path).toBe('/work/a.ts')
    expect(result.value.occurrencesReplaced).toBe(1)
    expect(sandbox.fs.get('/work/a.ts')).toBe('const a = 99\nconst b = 2\n')
    expect(result.value.bytesWritten).toBe(
      Buffer.byteLength('const a = 99\nconst b = 2\n', 'utf8'),
    )
  })

  it('refuses (Retry) when oldString === newString (no-op)', async () => {
    const sandbox = new FakeSandbox()
    sandbox.fs.set('/work/a.ts', 'x')
    const tool = editTool({ sandbox, retention: TEST_RETENTION })
    const result = await tool.run(
      { path: '/work/a.ts', oldString: 'x', newString: 'x' },
      makeTestCtx(),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as { reason: string }).reason).toBe('edit-no-op')
    expect(sandbox.calls.length).toBe(0)
  })

  it('refuses when expectedOccurrences does not match actual', async () => {
    const sandbox = new FakeSandbox()
    sandbox.fs.set('/work/a.ts', 'foo bar foo bar')
    const tool = editTool({ sandbox, retention: TEST_RETENTION })
    const result = await tool.run(
      {
        path: '/work/a.ts',
        oldString: 'foo',
        newString: 'baz',
        expectedOccurrences: 1,
      },
      makeTestCtx(),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as { reason: string }).reason).toContain('edit-occurrence-mismatch')
    expect(sandbox.fs.get('/work/a.ts')).toBe('foo bar foo bar')
  })

  it('replaces all occurrences when expectedOccurrences matches the actual count', async () => {
    const sandbox = new FakeSandbox()
    sandbox.fs.set('/work/a.ts', 'foo bar foo')
    const tool = editTool({ sandbox, retention: TEST_RETENTION })
    const result = await tool.run(
      {
        path: '/work/a.ts',
        oldString: 'foo',
        newString: 'baz',
        expectedOccurrences: 2,
      },
      makeTestCtx(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.occurrencesReplaced).toBe(2)
    expect(sandbox.fs.get('/work/a.ts')).toBe('baz bar baz')
  })

  it('returns Retry when the file does not exist', async () => {
    const sandbox = new FakeSandbox()
    const tool = editTool({ sandbox, retention: TEST_RETENTION })
    const result = await tool.run(
      { path: '/nope.ts', oldString: 'a', newString: 'b' },
      makeTestCtx(),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as { reason: string }).reason).toContain('edit-no-such-file')
  })

  it('does not write a partial file when occurrence count is wrong', async () => {
    const sandbox = new FakeSandbox()
    sandbox.fs.set('/work/a.ts', 'aa')
    const tool = editTool({ sandbox, retention: TEST_RETENTION })
    const before = sandbox.fs.get('/work/a.ts')
    await tool.run(
      {
        path: '/work/a.ts',
        oldString: 'a',
        newString: 'b',
        expectedOccurrences: 1,
      },
      makeTestCtx(),
    )
    expect(sandbox.fs.get('/work/a.ts')).toBe(before)
  })

  it('declares a read+write filesystem threatBoundary and public dataClassification', () => {
    const sandbox = new FakeSandbox()
    const tool = editTool({ sandbox, retention: TEST_RETENTION })
    expect(tool.dataClassification).toBe('public')
    expect(tool.threatBoundary.readsFilesystem).toBe(true)
    expect(tool.threatBoundary.writesFilesystem).toBe(true)
    expect(tool.threatBoundary.egressDomains).toBe('none')
  })

  it('returns Retry when the sandbox throws', async () => {
    const sandbox = new FakeSandbox()
    sandbox.fs.set('/work/a.ts', 'a')
    const exploding = {
      ...sandbox,
      tier: sandbox.tier,
      threatBoundary: sandbox.threatBoundary,
      exec: async () => {
        throw new Error('sandbox down')
      },
    }
    const tool = editTool({ sandbox: exploding, retention: TEST_RETENTION })
    const result = await tool.run(
      { path: '/work/a.ts', oldString: 'a', newString: 'b' },
      makeTestCtx(),
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as { reason: string }).reason).toBe('sandbox-exec-failed')
  })
})
