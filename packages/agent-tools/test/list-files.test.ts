import { describe, it, expect } from 'vitest'
import { listFilesTool } from '../src/list-files.js'
import { FakeSandbox, makeTestCtx, TEST_RETENTION } from './fake-sandbox.js'

describe('listFilesTool', () => {
  it('returns the entries the sandbox knows about under a path', async () => {
    const sandbox = new FakeSandbox()
    sandbox.fs.set('/work/a.txt', 'a')
    sandbox.fs.set('/work/b.txt', 'b')
    sandbox.fs.set('/work/sub/c.txt', 'c')
    const tool = listFilesTool({ sandbox, retention: TEST_RETENTION })
    const result = await tool.run({ path: '/work' }, makeTestCtx())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.files).toContain('a.txt')
    expect(result.value.files).toContain('b.txt')
    expect(result.value.files).toContain('sub/c.txt')
  })

  it('returns an empty list when the sandbox has no matches under the path', async () => {
    const sandbox = new FakeSandbox()
    const tool = listFilesTool({ sandbox, retention: TEST_RETENTION })
    const result = await tool.run({ path: '/empty' }, makeTestCtx())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.files).toEqual([])
  })

  it('declares the correct threatBoundary: reads filesystem, no writes, no egress', () => {
    const sandbox = new FakeSandbox()
    const tool = listFilesTool({ sandbox, retention: TEST_RETENTION })
    expect(tool.dataClassification).toBe('public')
    expect(tool.threatBoundary.readsFilesystem).toBe(true)
    expect(tool.threatBoundary.writesFilesystem).toBe(false)
    expect(tool.threatBoundary.egressDomains).toBe('none')
    expect(tool.threatBoundary.observesSecrets).toBe(false)
    expect(tool.threatBoundary.trustedCallers).toContain('agent-loop')
  })

  it('returns Retry when the sandbox throws (unreachable)', async () => {
    const sandbox = new FakeSandbox()
    const exploding = {
      ...sandbox,
      tier: sandbox.tier,
      threatBoundary: sandbox.threatBoundary,
      exec: async () => {
        throw new Error('sandbox unreachable')
      },
    }
    const tool = listFilesTool({ sandbox: exploding, retention: TEST_RETENTION })
    const result = await tool.run({ path: '/work' }, makeTestCtx())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as { retryable: true }).retryable).toBe(true)
  })

  it('returns Retry when the sandbox reports a non-zero exit code', async () => {
    const sandbox = new FakeSandbox()
    const failing = {
      ...sandbox,
      tier: sandbox.tier,
      threatBoundary: sandbox.threatBoundary,
      exec: async () => ({
        stdout: '',
        stderr: 'permission denied',
        exitCode: 13,
        durationMs: 1,
        tier: sandbox.tier,
        truncated: false,
      }),
    }
    const tool = listFilesTool({ sandbox: failing, retention: TEST_RETENTION })
    const result = await tool.run({ path: '/restricted' }, makeTestCtx())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as { retryable: true }).retryable).toBe(true)
    expect((result.error as { reason: string }).reason).toContain('list-files-nonzero-exit:13')
  })
})
