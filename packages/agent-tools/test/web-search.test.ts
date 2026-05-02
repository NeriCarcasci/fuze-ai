import { describe, it, expect } from 'vitest'
import { webSearchTool } from '../src/web-search.js'
import type {
  WebSearchHit,
  WebSearchProvider,
} from '../src/web-search/types.js'
import { FakeSandbox, makeTestCtx, TEST_RETENTION } from './fake-sandbox.js'

const fakeProvider = (hits: readonly WebSearchHit[]): WebSearchProvider => ({
  name: 'fake',
  egressDomains: ['fake.example.com'],
  buildRequest(query) {
    return {
      url: `https://fake.example.com/search?q=${encodeURIComponent(query)}`,
      method: 'GET',
      headers: { Accept: 'application/json' },
    }
  },
  parseResponse() {
    return hits
  },
})

describe('webSearchTool', () => {
  it('happy path returns hits and durationMs from sandbox response', async () => {
    const sandbox = new FakeSandbox({
      httpResponses: {
        'https://fake.example.com/search?q=hi': {
          status: 200,
          body: '{}',
          headers: { 'content-type': 'application/json' },
        },
      },
    })
    const tool = webSearchTool({
      sandbox,
      retention: TEST_RETENTION,
      provider: fakeProvider([
        { title: 'A', url: 'https://a.test', snippet: 'a snip' },
        { title: 'B', url: 'https://b.test', snippet: 'b snip' },
      ]),
    })
    const result = await tool.run({ query: 'hi' }, makeTestCtx())
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.hits).toHaveLength(2)
    expect(result.value.hits[0]).toEqual({
      title: 'A',
      url: 'https://a.test',
      snippet: 'a snip',
    })
    expect(result.value.durationMs).toBeGreaterThanOrEqual(0)
    expect(sandbox.fetchCalls).toHaveLength(1)
    const fc = sandbox.fetchCalls[0]!
    expect(fc.method).toBe('GET')
    expect(fc.headers.Accept).toBe('application/json')
  })

  it('non-2xx response returns Retry with status reason', async () => {
    const sandbox = new FakeSandbox({
      httpResponses: {
        'https://fake.example.com/search?q=hi': {
          status: 404,
          body: 'not found',
        },
      },
    })
    const tool = webSearchTool({
      sandbox,
      retention: TEST_RETENTION,
      provider: fakeProvider([]),
    })
    const result = await tool.run({ query: 'hi' }, makeTestCtx())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as { reason: string }).reason).toBe('web-search-status:404')
  })

  it('sandbox throw returns Retry sandbox-exec-failed', async () => {
    const sandbox = new FakeSandbox()
    const orig = sandbox.exec.bind(sandbox)
    sandbox.exec = async () => {
      void orig
      throw new Error('boom')
    }
    const tool = webSearchTool({
      sandbox,
      retention: TEST_RETENTION,
      provider: fakeProvider([]),
    })
    const result = await tool.run({ query: 'hi' }, makeTestCtx())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as { reason: string }).reason).toBe('sandbox-exec-failed')
  })

  it('sandbox nonzero-exit returns Retry web-search-nonzero-exit', async () => {
    const sandbox = new FakeSandbox()
    const tool = webSearchTool({
      sandbox,
      retention: TEST_RETENTION,
      provider: fakeProvider([]),
    })
    const result = await tool.run({ query: 'no-fixture' }, makeTestCtx())
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect((result.error as { reason: string }).reason).toContain(
      'web-search-nonzero-exit',
    )
  })

  it('declares provider egressDomains on threatBoundary and public dataClass', () => {
    const sandbox = new FakeSandbox()
    const tool = webSearchTool({
      sandbox,
      retention: TEST_RETENTION,
      provider: fakeProvider([]),
    })
    expect(tool.dataClassification).toBe('public')
    expect(tool.threatBoundary.egressDomains).toEqual(['fake.example.com'])
    expect(tool.threatBoundary.readsFilesystem).toBe(false)
    expect(tool.threatBoundary.writesFilesystem).toBe(false)
  })
})
