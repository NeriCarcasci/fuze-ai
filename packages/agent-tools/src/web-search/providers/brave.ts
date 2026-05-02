import type {
  WebSearchHit,
  WebSearchOptions,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResponseEnvelope,
} from '../types.js'

export interface BraveProviderOptions {
  readonly apiKey: string
}

const BRAVE_URL = 'https://api.search.brave.com/res/v1/web/search'
const BRAVE_DOMAIN = 'api.search.brave.com'

interface BraveWebResult {
  readonly title?: unknown
  readonly url?: unknown
  readonly description?: unknown
}

interface BraveResponse {
  readonly web?: { readonly results?: readonly BraveWebResult[] }
}

const mapSafeSearch = (s: WebSearchOptions['safeSearch']): string | undefined => {
  if (s === 'strict') return 'strict'
  if (s === 'moderate') return 'moderate'
  if (s === 'off') return 'off'
  return undefined
}

export const braveProvider = (opts: BraveProviderOptions): WebSearchProvider => ({
  name: 'brave',
  egressDomains: [BRAVE_DOMAIN],
  buildRequest(query: string, options: WebSearchOptions): WebSearchRequest {
    const params = new URLSearchParams()
    params.set('q', query)
    if (options.maxResults !== undefined) params.set('count', String(options.maxResults))
    const safe = mapSafeSearch(options.safeSearch)
    if (safe !== undefined) params.set('safesearch', safe)
    if (options.country !== undefined) params.set('country', options.country)
    return {
      url: `${BRAVE_URL}?${params.toString()}`,
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-Subscription-Token': opts.apiKey,
      },
    }
  },
  parseResponse(envelope: WebSearchResponseEnvelope): readonly WebSearchHit[] {
    const parsed = JSON.parse(envelope.body) as BraveResponse
    const results = parsed.web?.results ?? []
    const hits: WebSearchHit[] = []
    for (const r of results) {
      if (typeof r.title !== 'string' || typeof r.url !== 'string') continue
      hits.push({
        title: r.title,
        url: r.url,
        snippet: typeof r.description === 'string' ? r.description : '',
      })
    }
    return hits
  },
})
