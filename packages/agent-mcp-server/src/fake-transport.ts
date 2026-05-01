import type { JsonRpcHandler, JsonRpcRequest, JsonRpcResponse, McpServerTransport } from './types.js'

export class FakeMcpServerTransport implements McpServerTransport {
  private handler: JsonRpcHandler | null = null
  private stopped = false

  async start(handler: JsonRpcHandler): Promise<void> {
    this.handler = handler
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.handler = null
  }

  async sendRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (this.stopped) throw new Error('FakeMcpServerTransport: stopped')
    if (!this.handler) throw new Error('FakeMcpServerTransport: not started')
    return this.handler(req)
  }
}
