import { describe, it, expect } from 'vitest'
import { bashStreamTool } from '../src/bash-stream.js'
import { FakeSandbox, makeTestCtx, TEST_RETENTION } from './fake-sandbox.js'

interface CapturedChild {
  span: string
  attrs: Readonly<Record<string, unknown>>
  content?: unknown
}

const ctxWithCapture = (captured: CapturedChild[]) => {
  const base = makeTestCtx()
  return {
    ...base,
    emitChild: (child: CapturedChild) => {
      captured.push(child)
    },
  }
}

describe('bashStreamTool', () => {
  it('emits one tool.partial span per chunk and reconstructs total stdout in order', async () => {
    const sandbox = new FakeSandbox()
    const tool = bashStreamTool({ sandbox, retention: TEST_RETENTION })
    const captured: CapturedChild[] = []
    const result = await tool.run({ command: 'echo-lines a|b|c' }, ctxWithCapture(captured))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.chunkCount).toBe(3)
    expect(result.value.stdout).toBe('abc')
    expect(captured.length).toBe(3)
    captured.forEach((c, i) => {
      expect(c.span).toBe('tool.partial')
      expect(c.attrs['fuze.partial.sequence_number']).toBe(i)
      expect(c.attrs['fuze.partial.final_chunk']).toBe(i === captured.length - 1)
      expect(c.attrs['gen_ai.tool.name']).toBe('bash_stream')
    })
    const reconstructed = captured
      .slice()
      .sort(
        (a, b) =>
          (a.attrs['fuze.partial.sequence_number'] as number) -
          (b.attrs['fuze.partial.sequence_number'] as number),
      )
      .map((c) => (c.content as { chunk: string }).chunk)
      .join('')
    expect(reconstructed).toBe(result.value.stdout)
  })

  it('handles zero chunks (no partial spans emitted)', async () => {
    const sandbox = new FakeSandbox()
    const tool = bashStreamTool({ sandbox, retention: TEST_RETENTION })
    const captured: CapturedChild[] = []
    const result = await tool.run({ command: 'no-output' }, ctxWithCapture(captured))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.chunkCount).toBe(0)
    expect(result.value.stdout).toBe('')
    expect(captured.length).toBe(0)
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
    const tool = bashStreamTool({ sandbox: exploding, retention: TEST_RETENTION })
    const captured: CapturedChild[] = []
    const result = await tool.run({ command: 'echo-lines a' }, ctxWithCapture(captured))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as { retryable: true }).retryable).toBe(true)
    expect(captured.length).toBe(0)
  })

  it('declares the correct threatBoundary and public dataClassification', () => {
    const sandbox = new FakeSandbox()
    const tool = bashStreamTool({ sandbox, retention: TEST_RETENTION })
    expect(tool.dataClassification).toBe('public')
    expect(tool.name).toBe('bash_stream')
    expect(tool.threatBoundary.readsFilesystem).toBe(true)
    expect(tool.threatBoundary.writesFilesystem).toBe(true)
    expect(tool.threatBoundary.egressDomains).toBe('none')
  })

  it('still returns Ok with non-zero exit when the underlying command failed', async () => {
    const sandbox = new FakeSandbox()
    const tool = bashStreamTool({ sandbox, retention: TEST_RETENTION })
    const captured: CapturedChild[] = []
    const result = await tool.run({ command: 'fail-stream' }, ctxWithCapture(captured))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.exitCode).toBe(1)
    expect(result.value.stderr).toBe('boom')
    expect(captured.length).toBe(1)
  })
})
