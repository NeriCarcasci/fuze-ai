import { describe, it, expect } from 'vitest'
import { readFileTool } from '../src/read-file.js'
import { FakeSandbox, makeTestCtx, TEST_RETENTION } from './fake-sandbox.js'

describe('readFileTool', () => {
  it('reads a file the sandbox knows about', async () => {
    const sandbox = new FakeSandbox()
    sandbox.fs.set('/work/notes.txt', 'hello world')
    const tool = readFileTool({ sandbox, retention: TEST_RETENTION })
    const result = await tool.run({ path: '/work/notes.txt' }, makeTestCtx())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.content).toBe('hello world')
  })

  it('returns Retry when the file is missing', async () => {
    const sandbox = new FakeSandbox()
    const tool = readFileTool({ sandbox, retention: TEST_RETENTION })
    const result = await tool.run({ path: '/work/missing.txt' }, makeTestCtx())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as { retryable: true }).retryable).toBe(true)
  })

  it('declares readsFilesystem true and writesFilesystem false', () => {
    const sandbox = new FakeSandbox()
    const tool = readFileTool({ sandbox, retention: TEST_RETENTION })
    expect(tool.dataClassification).toBe('public')
    expect(tool.threatBoundary.readsFilesystem).toBe(true)
    expect(tool.threatBoundary.writesFilesystem).toBe(false)
    expect(tool.threatBoundary.egressDomains).toBe('none')
  })
})
