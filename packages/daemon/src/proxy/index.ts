/**
 * Fuze MCP Proxy — transparent safety layer for any MCP server.
 *
 * Usage: fuze-ai proxy [options] -- <server-command> [server-args...]
 */
import { TransportStdio } from './transport-stdio.js'
import { MCPBridge } from './mcp-bridge.js'
import { ToolInterceptor } from './tool-interceptor.js'
import type {
  JsonRpcMessage,
  JsonRpcResponse,
  ProxyConfig,
  ToolCallMessage,
} from './types.js'
import { isRequest, isResponse, isToolCall } from './types.js'

// ── ProxyRouter ───────────────────────────────────────────────────────────────

/**
 * Core message-routing logic. Separated from startup/shutdown so it is
 * testable without real stdio or child processes.
 */
export class ProxyRouter {
  private readonly pendingMethods = new Map<number | string, string>()

  constructor(
    private readonly transport: {
      onClientMessage: (h: (m: JsonRpcMessage) => void) => void
      sendToClient: (m: JsonRpcMessage) => void
      start: () => void
      stop: () => void
    },
    private readonly bridge: {
      onServerMessage: (h: (m: JsonRpcMessage) => void) => void
      onServerExit: (h: (code: number | null, signal: string | null) => void) => void
      sendToServer: (m: JsonRpcMessage) => void
      stop: () => Promise<void>
    },
    private readonly interceptor: ToolInterceptor,
    private readonly opts: { verbose: boolean; serverLabel: string },
  ) {}

  /** Wire up message handlers and begin routing. */
  start(onServerExit?: (code: number | null) => void | Promise<void>): void {
    this.transport.onClientMessage((msg) => {
      void this._handleClientMessage(msg)
    })

    this.bridge.onServerMessage((msg) => {
      this._handleServerMessage(msg)
    })

    this.bridge.onServerExit((code, signal) => {
      process.stderr.write(
        `[fuze] Server exited (code=${code ?? 'null'}, signal=${signal ?? 'none'}) — shutting down\n`,
      )
      const stats = this.interceptor.getStats()
      process.stderr.write(
        `[fuze] Session: ${stats.totalCalls} calls, ` +
        `${stats.blockedCalls} blocked, $${stats.totalCost.toFixed(4)} spent\n`,
      )
      onServerExit?.(code ?? 0)
    })

    this.transport.start()
    process.stderr.write(`[fuze] Proxy started — wrapping: ${this.opts.serverLabel}\n`)
  }

  /** Graceful shutdown. */
  async stop(): Promise<void> {
    this.transport.stop()
    await this.bridge.stop()
    const stats = this.interceptor.getStats()
    process.stderr.write(
      `[fuze] Proxy shutting down — ` +
      `${stats.totalCalls} calls, ${stats.blockedCalls} blocked, $${stats.totalCost.toFixed(4)} spent\n`,
    )
  }

  // ── Private ──────────────────────────────────────────────────────────────

  private async _handleClientMessage(msg: JsonRpcMessage): Promise<void> {
    if (this.opts.verbose && isRequest(msg)) {
      process.stderr.write(`[fuze] ← client: ${msg.method}\n`)
    }

    if (isToolCall(msg)) {
      const decision = await this.interceptor.intercept(msg as ToolCallMessage)
      if (decision.action === 'block') {
        if (this.opts.verbose) {
          process.stderr.write(
            `[fuze] BLOCKED: ${(msg as ToolCallMessage).params.name} — ` +
            `${decision.response.error.message.slice(0, 80)}\n`,
          )
        }
        this.transport.sendToClient(decision.response)
      } else {
        this.bridge.sendToServer(msg)
      }
    } else {
      // Track request method by ID for response routing
      if (isRequest(msg)) {
        this.pendingMethods.set(msg.id, msg.method)
      }
      // Forward everything else transparently
      this.bridge.sendToServer(msg)
    }
  }

  private _handleServerMessage(msg: JsonRpcMessage): void {
    if (this.opts.verbose && isResponse(msg)) {
      process.stderr.write(`[fuze] → client: response id=${msg.id}\n`)
    }

    if (isResponse(msg) && msg.result != null) {
      const responseId = (msg as JsonRpcResponse).id
      const method = this.pendingMethods.get(responseId)
      this.pendingMethods.delete(responseId)

      if (method === 'tools/list') {
        const result = msg.result as Record<string, unknown>
        if (Array.isArray(result['tools'])) {
          this.interceptor.setAvailableTools(
            result['tools'] as import('./types.js').McpTool[],
          )
        }
      }

      // Record tool call results (interceptor tracks pending calls by ID; no-ops for unknown IDs)
      this.interceptor.recordResult(
        'unknown',
        responseId,
        msg.result as import('./types.js').ToolCallResult,
      )
    }

    this.transport.sendToClient(msg)
  }
}

// ── CLI entry point ───────────────────────────────────────────────────────────

/**
 * Parse proxy CLI args and start the proxy.
 *
 * Usage: fuze-ai proxy [options] -- <server-command> [server-args...]
 */
export async function runProxy(argv: string[]): Promise<void> {
  // Find the '--' separator
  const sepIdx = argv.indexOf('--')
  if (sepIdx === -1 || sepIdx === argv.length - 1) {
    process.stderr.write(
      'Usage: fuze-ai proxy [options] -- <server-command> [server-args...]\n',
    )
    process.exit(1)
  }

  const proxyArgs = argv.slice(0, sepIdx)
  const serverArgs = argv.slice(sepIdx + 1)
  const serverCommand = serverArgs[0]
  const serverCommandArgs = serverArgs.slice(1)

  // Parse proxy options
  const config = parseProxyArgs(proxyArgs)

  // Build the label shown in logs
  const serverLabel = serverArgs.join(' ')

  // Instantiate components
  const transport = new TransportStdio()
  const bridge = new MCPBridge(serverCommand, serverCommandArgs)
  const interceptor = new ToolInterceptor(config, config.tracePath)

  const router = new ProxyRouter(transport, bridge, interceptor, {
    verbose: config.verbose,
    serverLabel,
  })

  // Spawn the real server
  await bridge.start()

  // Wire up and start routing
  router.start(async (code) => {
    await router.stop()
    process.exit(code ?? 0)
  })

  // Graceful shutdown handlers
  const shutdown = async (signal: string): Promise<void> => {
    process.stderr.write(`\n[fuze] Received ${signal}\n`)
    await router.stop()
    process.exit(0)
  }

  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
}

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseProxyArgs(args: string[]): ProxyConfig {
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag)
    return idx !== -1 ? args[idx + 1] : undefined
  }

  return {
    maxCostPerRun: get('--max-cost') != null ? Number(get('--max-cost')) : 10.0,
    maxIterations: get('--max-iterations') != null ? Number(get('--max-iterations')) : 50,
    tracePath: get('--trace') ?? './fuze-proxy-traces.jsonl',
    verbose: args.includes('--verbose'),
    daemonSocket: get('--daemon'),
    tools: {},
  }
}
