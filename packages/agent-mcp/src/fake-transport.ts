import type { McpAdmission } from './types.js'
import type { McpMessageHandler, McpTransport, McpTransportFactory } from './transport.js'

export interface FakeMcpTransportOptions {
  readonly serverId: string
  readonly tools?: ReadonlyArray<{ readonly name: string; readonly description: string }>
}

const stableKey = (method: string, params: unknown): string => `${method}::${JSON.stringify(params ?? null)}`

export class FakeMcpTransport implements McpTransport {
  private readonly responses = new Map<string, unknown>()
  private readonly methodResponses = new Map<string, unknown>()
  private readonly handlers: McpMessageHandler[] = []
  private closed = false
  readonly serverId: string
  readonly requests: Array<{ method: string; params: unknown }> = []

  constructor(opts: FakeMcpTransportOptions) {
    this.serverId = opts.serverId
    if (opts.tools) {
      this.methodResponses.set('tools/list', { tools: opts.tools })
    }
  }

  setResponse(method: string, params: unknown, response: unknown): void {
    this.responses.set(stableKey(method, params), response)
  }

  setMethodResponse(method: string, response: unknown): void {
    this.methodResponses.set(method, response)
  }

  async request(method: string, params?: unknown): Promise<unknown> {
    if (this.closed) {
      throw new Error(`FakeMcpTransport(${this.serverId}): closed`)
    }
    this.requests.push({ method, params })
    const keyed = this.responses.get(stableKey(method, params))
    if (keyed !== undefined) return keyed
    const generic = this.methodResponses.get(method)
    if (generic !== undefined) return generic
    throw new Error(`FakeMcpTransport(${this.serverId}): no response set for ${method}`)
  }

  async close(): Promise<void> {
    this.closed = true
  }

  isClosed(): boolean {
    return this.closed
  }

  onMessage(handler: McpMessageHandler): void {
    this.handlers.push(handler)
  }

  emit(message: unknown): void {
    for (const h of this.handlers) h(message)
  }
}

export class FakeMcpTransportFactory implements McpTransportFactory {
  readonly created: FakeMcpTransport[] = []

  constructor(
    private readonly configure?: (admission: McpAdmission, transport: FakeMcpTransport) => void,
  ) {}

  async create(admission: McpAdmission): Promise<FakeMcpTransport> {
    const t = new FakeMcpTransport({ serverId: admission.serverId })
    if (this.configure) this.configure(admission, t)
    this.created.push(t)
    return t
  }
}
