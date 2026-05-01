import type { McpAdmission } from './types.js'

export type McpMessageHandler = (message: unknown) => void

export interface McpTransport {
  request(method: string, params?: unknown): Promise<unknown>
  close(): Promise<void>
  onMessage(handler: McpMessageHandler): void
}

export interface McpTransportFactory {
  create(admission: McpAdmission): Promise<McpTransport>
}

export interface ToolCallRecord {
  readonly serverId: string
  readonly method: string
  readonly params: unknown
  readonly response?: unknown
  readonly error?: { readonly message: string }
  readonly startedAt: number
  readonly endedAt: number
  readonly durationMs: number
}

export type ToolCallObserver = (record: ToolCallRecord) => void

export class RecordingTransport implements McpTransport {
  constructor(
    private readonly inner: McpTransport,
    private readonly serverId: string,
    private readonly observer: ToolCallObserver,
  ) {}

  async request(method: string, params?: unknown): Promise<unknown> {
    const isToolCall = method === 'tools/call'
    if (!isToolCall) {
      return this.inner.request(method, params)
    }
    const startedAt = Date.now()
    try {
      const response = await this.inner.request(method, params)
      const endedAt = Date.now()
      this.observer({
        serverId: this.serverId,
        method,
        params,
        response,
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
      })
      return response
    } catch (e) {
      const endedAt = Date.now()
      const message = e instanceof Error ? e.message : String(e)
      this.observer({
        serverId: this.serverId,
        method,
        params,
        error: { message },
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
      })
      throw e
    }
  }

  async close(): Promise<void> {
    return this.inner.close()
  }

  onMessage(handler: McpMessageHandler): void {
    this.inner.onMessage(handler)
  }
}
