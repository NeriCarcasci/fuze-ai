export interface WebSearchHit {
  readonly title: string
  readonly url: string
  readonly snippet: string
}

export interface WebSearchOptions {
  readonly maxResults?: number
  readonly country?: string
  readonly safeSearch?: 'strict' | 'moderate' | 'off'
}

export interface WebSearchRequest {
  readonly url: string
  readonly method?: string
  readonly headers?: Record<string, string>
  readonly body?: string
}

export interface WebSearchResponseEnvelope {
  readonly status: number
  readonly body: string
  readonly headers: Record<string, string>
}

export interface WebSearchProvider {
  readonly name: string
  readonly egressDomains: readonly string[]
  buildRequest(query: string, opts: WebSearchOptions): WebSearchRequest
  parseResponse(envelope: WebSearchResponseEnvelope): readonly WebSearchHit[]
}
