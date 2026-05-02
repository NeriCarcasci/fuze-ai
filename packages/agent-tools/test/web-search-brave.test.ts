import { describe, it, expect } from 'vitest'
import { braveProvider } from '../src/web-search/providers/brave.js'

describe('braveProvider', () => {
  it('declares name and egress domain', () => {
    const p = braveProvider({ apiKey: 'k' })
    expect(p.name).toBe('brave')
    expect(p.egressDomains).toEqual(['api.search.brave.com'])
  })

  it('buildRequest produces Brave-shaped GET with X-Subscription-Token', () => {
    const p = braveProvider({ apiKey: 'k-1' })
    const req = p.buildRequest('hello world', {
      maxResults: 5,
      country: 'us',
      safeSearch: 'strict',
    })
    expect(req.method).toBe('GET')
    expect(req.url.startsWith('https://api.search.brave.com/res/v1/web/search?')).toBe(
      true,
    )
    const params = new URL(req.url).searchParams
    expect(params.get('q')).toBe('hello world')
    expect(params.get('count')).toBe('5')
    expect(params.get('safesearch')).toBe('strict')
    expect(params.get('country')).toBe('us')
    expect(req.headers?.['X-Subscription-Token']).toBe('k-1')
    expect(req.headers?.['Accept']).toBe('application/json')
    expect(req.body).toBeUndefined()
  })

  it('parseResponse maps web.results -> WebSearchHit[]', () => {
    const p = braveProvider({ apiKey: 'k' })
    const fixture = {
      web: {
        results: [
          { title: 'A', url: 'https://a.test', description: 'A snippet' },
          { title: 'B', url: 'https://b.test', description: 'B snippet' },
          { title: 'no-url' },
        ],
      },
    }
    const hits = p.parseResponse({
      status: 200,
      body: JSON.stringify(fixture),
      headers: {},
    })
    expect(hits).toEqual([
      { title: 'A', url: 'https://a.test', snippet: 'A snippet' },
      { title: 'B', url: 'https://b.test', snippet: 'B snippet' },
    ])
  })

  it('parseResponse tolerates missing description', () => {
    const p = braveProvider({ apiKey: 'k' })
    const hits = p.parseResponse({
      status: 200,
      body: JSON.stringify({ web: { results: [{ title: 'T', url: 'https://t.test' }] } }),
      headers: {},
    })
    expect(hits).toEqual([{ title: 'T', url: 'https://t.test', snippet: '' }])
  })
})
