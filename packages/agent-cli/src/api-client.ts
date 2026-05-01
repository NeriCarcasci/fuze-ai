export type FetchImpl = (input: string, init?: RequestInit) => Promise<Response>

export interface ApiClientOptions {
  readonly baseUrl: string
  readonly apiKey: string
  readonly fetchImpl?: FetchImpl
  readonly maxRetries?: number
  readonly retryDelayMs?: number
}

export interface AuditQueryParams {
  readonly subject: string
  readonly since?: string
  readonly limit?: number
}

export interface AuditQueryResponse {
  readonly spans: ReadonlyArray<Record<string, unknown>>
}

export interface RunReplayResponse {
  readonly spans: ReadonlyArray<Record<string, unknown>>
}

export interface VerifyResponse {
  readonly runId: string
  readonly chainValid: boolean
  readonly transparencyAnchor: { readonly logId: string; readonly index: number; readonly verified: boolean } | null
}

export interface ApprovalRequest {
  readonly runId: string
  readonly action: 'approve' | 'reject' | 'halt' | 'override'
  readonly rationale: string
  readonly overseer: string
}

export interface ApprovalResponse {
  readonly runId: string
  readonly accepted: boolean
  readonly resumeToken?: string
}

export interface HealthResponse {
  readonly ok: boolean
  readonly version?: string
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message)
    this.name = 'ApiClientError'
  }
}

export class ApiClient {
  private readonly fetchImpl: FetchImpl
  private readonly maxRetries: number
  private readonly retryDelayMs: number

  constructor(private readonly opts: ApiClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? ((input, init) => fetch(input, init))
    this.maxRetries = opts.maxRetries ?? 2
    this.retryDelayMs = opts.retryDelayMs ?? 50
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const url = `${this.opts.baseUrl.replace(/\/$/, '')}${path}`
    const headers: Record<string, string> = {
      authorization: `Bearer ${this.opts.apiKey}`,
      accept: 'application/json',
      ...(init?.headers as Record<string, string> | undefined),
    }
    if (init?.body !== undefined && headers['content-type'] === undefined) {
      headers['content-type'] = 'application/json'
    }

    let lastError: unknown
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await this.fetchImpl(url, { ...init, headers })
        if (res.status >= 500 && attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, this.retryDelayMs))
          continue
        }
        const text = await res.text()
        if (!res.ok) {
          throw new ApiClientError(`HTTP ${res.status} on ${path}`, res.status, text)
        }
        return text.length === 0 ? (undefined as T) : (JSON.parse(text) as T)
      } catch (err) {
        if (err instanceof ApiClientError) throw err
        lastError = err
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, this.retryDelayMs))
          continue
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  }

  health(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/v1/health')
  }

  auditQuery(params: AuditQueryParams): Promise<AuditQueryResponse> {
    const qs = new URLSearchParams()
    if (params.since !== undefined) qs.set('since', params.since)
    if (params.limit !== undefined) qs.set('limit', String(params.limit))
    const suffix = qs.toString().length === 0 ? '' : `?${qs.toString()}`
    return this.request<AuditQueryResponse>(
      `/v1/subjects/${encodeURIComponent(params.subject)}/spans${suffix}`,
    )
  }

  runReplay(runId: string): Promise<RunReplayResponse> {
    return this.request<RunReplayResponse>(`/v1/runs/${encodeURIComponent(runId)}/spans`)
  }

  runVerify(runId: string): Promise<VerifyResponse> {
    return this.request<VerifyResponse>(`/v1/runs/${encodeURIComponent(runId)}/verify`)
  }

  approve(req: ApprovalRequest): Promise<ApprovalResponse> {
    return this.request<ApprovalResponse>(
      `/v1/suspended-runs/${encodeURIComponent(req.runId)}/decisions`,
      {
        method: 'POST',
        body: JSON.stringify({
          decision: {
            action: req.action,
            rationale: req.rationale,
            overseerId: req.overseer,
          },
        }),
      },
    )
  }
}
