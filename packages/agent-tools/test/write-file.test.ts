import { describe, it, expect } from 'vitest'
import { writeFileTool } from '../src/write-file.js'
import { FakeSandbox, makeTestCtx, TEST_RETENTION } from './fake-sandbox.js'

describe('writeFileTool', () => {
  it('writes content and reports byte count', async () => {
    const sandbox = new FakeSandbox()
    const tool = writeFileTool({ sandbox, retention: TEST_RETENTION })
    const result = await tool.run({ path: '/work/out.txt', content: 'hello' }, makeTestCtx())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.bytesWritten).toBe(5)
    expect(sandbox.fs.get('/work/out.txt')).toBe('hello')
  })

  it('counts UTF-8 bytes (not characters) for multibyte content', async () => {
    const sandbox = new FakeSandbox()
    const tool = writeFileTool({ sandbox, retention: TEST_RETENTION })
    const content = 'café'
    const result = await tool.run({ path: '/work/u.txt', content }, makeTestCtx())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.bytesWritten).toBe(Buffer.byteLength(content, 'utf8'))
  })

  it('declares writesFilesystem true and readsFilesystem false', () => {
    const sandbox = new FakeSandbox()
    const tool = writeFileTool({ sandbox, retention: TEST_RETENTION })
    expect(tool.dataClassification).toBe('public')
    expect(tool.threatBoundary.writesFilesystem).toBe(true)
    expect(tool.threatBoundary.readsFilesystem).toBe(false)
    expect(tool.threatBoundary.egressDomains).toBe('none')
  })
})
