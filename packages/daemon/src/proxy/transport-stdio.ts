import { createInterface, type Interface } from 'node:readline'
import type { JsonRpcMessage } from './types.js'

/**
 * Handles JSON-RPC 2.0 stdio transport between the MCP client and the proxy.
 *
 * - Reads newline-delimited JSON from process.stdin (client → proxy)
 * - Writes newline-delimited JSON to process.stdout (proxy → client)
 *
 * IMPORTANT: All proxy logging goes to process.stderr. process.stdout is
 * reserved exclusively for MCP protocol messages to the client.
 */
export class TransportStdio {
  private handler: ((msg: JsonRpcMessage) => void) | null = null
  private rl: Interface | null = null

  /**
   * Register a handler for messages received from the client.
   */
  onClientMessage(handler: (message: JsonRpcMessage) => void): void {
    this.handler = handler
  }

  /**
   * Send a JSON-RPC message to the client.
   */
  sendToClient(message: JsonRpcMessage): void {
    process.stdout.write(JSON.stringify(message) + '\n')
  }

  /**
   * Start reading from process.stdin.
   */
  start(): void {
    this.rl = createInterface({ input: process.stdin, crlfDelay: Infinity })

    this.rl.on('line', (line) => {
      const trimmed = line.trim()
      if (!trimmed) return
      try {
        const msg = JSON.parse(trimmed) as JsonRpcMessage
        this.handler?.(msg)
      } catch {
        process.stderr.write(`[fuze] Non-JSON from client, skipping: ${trimmed.slice(0, 100)}\n`)
      }
    })
  }

  /**
   * Stop reading from stdin.
   */
  stop(): void {
    this.rl?.close()
    this.rl = null
  }
}
