import { createInterface, type Interface as ReadlineInterface } from 'node:readline'
import type { Readable, Writable } from 'node:stream'
import type { JsonRpcHandler, JsonRpcRequest, McpServerTransport } from './types.js'
import { JSON_RPC_ERR } from './types.js'

export interface StdioMcpServerTransportOptions {
  readonly stdin?: Readable
  readonly stdout?: Writable
}

export class StdioMcpServerTransport implements McpServerTransport {
  private rl: ReadlineInterface | null = null
  private readonly stdin: Readable
  private readonly stdout: Writable
  private stopped = false

  constructor(opts: StdioMcpServerTransportOptions = {}) {
    this.stdin = opts.stdin ?? process.stdin
    this.stdout = opts.stdout ?? process.stdout
  }

  async start(handler: JsonRpcHandler): Promise<void> {
    this.rl = createInterface({ input: this.stdin, crlfDelay: Infinity })
    this.rl.on('line', (line: string) => {
      if (this.stopped) return
      const trimmed = line.trim()
      if (trimmed.length === 0) return
      void this.processLine(trimmed, handler)
    })
  }

  private async processLine(line: string, handler: JsonRpcHandler): Promise<void> {
    let req: JsonRpcRequest
    try {
      req = JSON.parse(line) as JsonRpcRequest
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.write({
        jsonrpc: '2.0',
        id: null,
        error: { code: JSON_RPC_ERR.ParseError, message: `parse error: ${msg}` },
      })
      return
    }
    try {
      const res = await handler(req)
      this.write(res)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.write({
        jsonrpc: '2.0',
        id: req.id ?? null,
        error: { code: JSON_RPC_ERR.InternalError, message: msg },
      })
    }
  }

  private write(obj: unknown): void {
    this.stdout.write(`${JSON.stringify(obj)}\n`)
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.rl) {
      this.rl.close()
      this.rl = null
    }
  }
}
