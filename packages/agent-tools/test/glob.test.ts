import { describe, it, expect } from 'vitest'
import { globTool } from '../src/glob.js'
import { FakeSandbox, makeTestCtx, TEST_RETENTION } from './fake-sandbox.js'

const seed = (sandbox: FakeSandbox): void => {
  sandbox.fs.set('/work/src/a.ts', 'a')
  sandbox.fs.set('/work/src/b.ts', 'b')
  sandbox.fs.set('/work/src/c.js', 'c')
  sandbox.fs.set('/work/src/nested/d.ts', 'd')
  sandbox.fs.set('/work/README.md', 'readme')
}

describe('globTool', () => {
  it('matches **/*.ts under a path', async () => {
    const sandbox = new FakeSandbox()
    seed(sandbox)
    const tool = globTool({ sandbox, retention: TEST_RETENTION })
    const result = await tool.run({ pattern: '**/*.ts', path: '/work' }, makeTestCtx())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const paths = result.value.paths.sort()
    expect(paths).toEqual([
      '/work/src/a.ts',
      '/work/src/b.ts',
      '/work/src/nested/d.ts',
    ])
    expect(result.value.truncated).toBe(false)
  })

  it('* does not cross directory boundaries', async () => {
    const sandbox = new FakeSandbox()
    seed(sandbox)
    const tool = globTool({ sandbox, retention: TEST_RETENTION })
    const result = await tool.run({ pattern: 'src/*.ts', path: '/work' }, makeTestCtx())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const paths = result.value.paths.sort()
    expect(paths).toEqual(['/work/src/a.ts', '/work/src/b.ts'])
  })

  it('honors maxResults and reports truncated=true', async () => {
    const sandbox = new FakeSandbox()
    seed(sandbox)
    const tool = globTool({ sandbox, retention: TEST_RETENTION })
    const result = await tool.run(
      { pattern: '**/*.ts', path: '/work', maxResults: 2 },
      makeTestCtx(),
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.paths.length).toBe(2)
    expect(result.value.truncated).toBe(true)
  })

  it('returns an empty list when nothing matches', async () => {
    const sandbox = new FakeSandbox()
    seed(sandbox)
    const tool = globTool({ sandbox, retention: TEST_RETENTION })
    const result = await tool.run({ pattern: '**/*.rs', path: '/work' }, makeTestCtx())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.paths).toEqual([])
    expect(result.value.truncated).toBe(false)
  })

  it('declares a read-only filesystem threatBoundary and public dataClassification', () => {
    const sandbox = new FakeSandbox()
    const tool = globTool({ sandbox, retention: TEST_RETENTION })
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
    const tool = globTool({ sandbox: exploding, retention: TEST_RETENTION })
    const result = await tool.run({ pattern: '**/*.ts', path: '/work' }, makeTestCtx())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as { reason: string }).reason).toBe('sandbox-exec-failed')
  })
})
