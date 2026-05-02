import { describe, it, expect } from 'vitest'
import { tavilyProvider } from '../src/web-search/providers/tavily.js'

describe('tavilyProvider', () => {
  it('declares name and egress domain', () => {
    const p = tavilyProvider({ apiKey: 'k' })
    expect(p.name).toBe('tavily')
    expect(p.egressDomains).toEqual(['api.tavily.com'])
  })

  it('buildRequest is POST with api_key + query in JSON body', () => {
    const p = tavilyProvider({ apiKey: 'k-2' })
    const req = p.buildRequest('hello', { maxResults: 3, country: 'fr' })
    expect(req.url).toBe('https://api.tavily.com/search')
    expect(req.method).toBe('POST')
    expect(req.headers?.['Content-Type']).toBe('application/json')
    expect(req.body).toBeDefined()
    const body = JSON.parse(req.body!)
    expect(body.api_key).toBe('k-2')
    expect(body.query).toBe('hello')
    expect(body.max_results).toBe(3)
    expect(body.country).toBe('fr')
    expect(body.include_answer).toBe(false)
  })

  it('parseResponse maps results -> WebSearchHit[] using content as snippet', () => {
    const p = tavilyProvider({ apiKey: 'k' })
    const fixture = {
      results: [
        { title: 'X', url: 'https://x.test', content: 'X content' },
        { title: 'Y', url: 'https://y.test', content: 'Y content' },
        { title: 'no-url' },
      ],
    }
    const hits = p.parseResponse({
      status: 200,
      body: JSON.stringify(fixture),
      headers: {},
    })
    expect(hits).toEqual([
      { title: 'X', url: 'https://x.test', snippet: 'X content' },
      { title: 'Y', url: 'https://y.test', snippet: 'Y content' },
    ])
  })

  it('parseResponse tolerates missing content', () => {
    const p = tavilyProvider({ apiKey: 'k' })
    const hits = p.parseResponse({
      status: 200,
      body: JSON.stringify({ results: [{ title: 'T', url: 'https://t.test' }] }),
      headers: {},
    })
    expect(hits).toEqual([{ title: 'T', url: 'https://t.test', snippet: '' }])
  })
})
