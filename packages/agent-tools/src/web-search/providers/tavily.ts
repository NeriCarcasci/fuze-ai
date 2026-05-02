import type {
  WebSearchHit,
  WebSearchOptions,
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResponseEnvelope,
} from '../types.js'

export interface TavilyProviderOptions {
  readonly apiKey: string
}

const TAVILY_URL = 'https://api.tavily.com/search'
const TAVILY_DOMAIN = 'api.tavily.com'

interface TavilyResult {
  readonly title?: unknown
  readonly url?: unknown
  readonly content?: unknown
}

interface TavilyResponse {
  readonly results?: readonly TavilyResult[]
}

export const tavilyProvider = (opts: TavilyProviderOptions): WebSearchProvider => ({
  name: 'tavily',
  egressDomains: [TAVILY_DOMAIN],
  buildRequest(query: string, options: WebSearchOptions): WebSearchRequest {
    const body: Record<string, unknown> = {
      api_key: opts.apiKey,
      query,
      include_answer: false,
    }
    if (options.maxResults !== undefined) body['max_results'] = options.maxResults
    if (options.country !== undefined) body['country'] = options.country
    return {
      url: TAVILY_URL,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    }
  },
  parseResponse(envelope: WebSearchResponseEnvelope): readonly WebSearchHit[] {
    const parsed = JSON.parse(envelope.body) as TavilyResponse
    const results = parsed.results ?? []
    const hits: WebSearchHit[] = []
    for (const r of results) {
      if (typeof r.title !== 'string' || typeof r.url !== 'string') continue
      hits.push({
        title: r.title,
        url: r.url,
        snippet: typeof r.content === 'string' ? r.content : '',
      })
    }
    return hits
  },
})
