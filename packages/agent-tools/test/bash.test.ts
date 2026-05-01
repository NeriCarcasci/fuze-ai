import { describe, it, expect } from 'vitest'
import { bashTool } from '../src/bash.js'
import { FakeSandbox, makeTestCtx, TEST_RETENTION } from './fake-sandbox.js'

describe('bashTool', () => {
  it('roundtrip: echoes a command and returns Ok with stdout', async () => {
    const sandbox = new FakeSandbox()
    const tool = bashTool({ sandbox, retention: TEST_RETENTION })
    const result = await tool.run({ command: 'echo hello' }, makeTestCtx())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.stdout).toBe('hello')
    expect(result.value.exitCode).toBe(0)
    expect(result.value.tier).toBe('in-process')
  })

  it('passes stdin through to the sandbox', async () => {
    const sandbox = new FakeSandbox()
    const tool = bashTool({ sandbox, retention: TEST_RETENTION })
    const result = await tool.run({ command: 'cat-stdin', stdin: 'piped-payload' }, makeTestCtx())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.stdout).toBe('piped-payload')
    expect(sandbox.calls[0]?.stdin).toBe('piped-payload')
  })

  it('surfaces non-zero exit codes in the output (no Retry)', async () => {
    const sandbox = new FakeSandbox()
    const tool = bashTool({ sandbox, retention: TEST_RETENTION })
    const result = await tool.run({ command: 'fail' }, makeTestCtx())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.exitCode).toBe(1)
    expect(result.value.stderr).toBe('boom')
  })

  it('declares the correct threatBoundary and public dataClassification', () => {
    const sandbox = new FakeSandbox()
    const tool = bashTool({ sandbox, retention: TEST_RETENTION })
    expect(tool.dataClassification).toBe('public')
    expect(tool.threatBoundary.readsFilesystem).toBe(true)
    expect(tool.threatBoundary.writesFilesystem).toBe(true)
    expect(tool.threatBoundary.egressDomains).toBe('none')
    expect(tool.threatBoundary.trustedCallers).toContain('agent-loop')
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
    const tool = bashTool({ sandbox: exploding, retention: TEST_RETENTION })
    const result = await tool.run({ command: 'echo nope' }, makeTestCtx())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as { retryable: true }).retryable).toBe(true)
  })
})
