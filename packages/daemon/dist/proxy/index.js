/**
 * Fuze MCP Proxy — transparent safety layer for any MCP server.
 *
 * Usage: fuze-ai proxy [options] -- <server-command> [server-args...]
 */
import { TransportStdio } from './transport-stdio.js';
import { MCPBridge } from './mcp-bridge.js';
import { ToolInterceptor } from './tool-interceptor.js';
import { isRequest, isResponse, isToolCall } from './types.js';
// ── ProxyRouter ───────────────────────────────────────────────────────────────
/**
 * Core message-routing logic. Separated from startup/shutdown so it is
 * testable without real stdio or child processes.
 */
export class ProxyRouter {
    transport;
    bridge;
    interceptor;
    opts;
    pendingMethods = new Map();
    constructor(transport, bridge, interceptor, opts) {
        this.transport = transport;
        this.bridge = bridge;
        this.interceptor = interceptor;
        this.opts = opts;
    }
    /** Wire up message handlers and begin routing. */
    start(onServerExit) {
        this.transport.onClientMessage((msg) => {
            void this._handleClientMessage(msg);
        });
        this.bridge.onServerMessage((msg) => {
            this._handleServerMessage(msg);
        });
        this.bridge.onServerExit((code, signal) => {
            process.stderr.write(`[fuze] Server exited (code=${code ?? 'null'}, signal=${signal ?? 'none'}) — shutting down\n`);
            const stats = this.interceptor.getStats();
            process.stderr.write(`[fuze] Session: ${stats.totalCalls} calls, ` +
                `${stats.blockedCalls} blocked, $${stats.totalCost.toFixed(4)} spent\n`);
            onServerExit?.(code ?? 0);
        });
        this.transport.start();
        process.stderr.write(`[fuze] Proxy started — wrapping: ${this.opts.serverLabel}\n`);
    }
    /** Graceful shutdown. */
    async stop() {
        this.transport.stop();
        await this.bridge.stop();
        const stats = this.interceptor.getStats();
        process.stderr.write(`[fuze] Proxy shutting down — ` +
            `${stats.totalCalls} calls, ${stats.blockedCalls} blocked, $${stats.totalCost.toFixed(4)} spent\n`);
    }
    // ── Private ──────────────────────────────────────────────────────────────
    async _handleClientMessage(msg) {
        if (this.opts.verbose && isRequest(msg)) {
            process.stderr.write(`[fuze] ← client: ${msg.method}\n`);
        }
        if (isToolCall(msg)) {
            const decision = await this.interceptor.intercept(msg);
            if (decision.action === 'block') {
                if (this.opts.verbose) {
                    process.stderr.write(`[fuze] BLOCKED: ${msg.params.name} — ` +
                        `${decision.response.error.message.slice(0, 80)}\n`);
                }
                this.transport.sendToClient(decision.response);
            }
            else {
                this.bridge.sendToServer(msg);
            }
        }
        else {
            // Track request method by ID for response routing
            if (isRequest(msg)) {
                this.pendingMethods.set(msg.id, msg.method);
            }
            // Forward everything else transparently
            this.bridge.sendToServer(msg);
        }
    }
    _handleServerMessage(msg) {
        if (this.opts.verbose && isResponse(msg)) {
            process.stderr.write(`[fuze] → client: response id=${msg.id}\n`);
        }
        if (isResponse(msg) && msg.result != null) {
            const responseId = msg.id;
            const method = this.pendingMethods.get(responseId);
            this.pendingMethods.delete(responseId);
            if (method === 'tools/list') {
                const result = msg.result;
                if (Array.isArray(result['tools'])) {
                    this.interceptor.setAvailableTools(result['tools']);
                }
            }
            // Record tool call results (interceptor tracks pending calls by ID; no-ops for unknown IDs)
            this.interceptor.recordResult('unknown', responseId, msg.result);
        }
        this.transport.sendToClient(msg);
    }
}
// ── CLI entry point ───────────────────────────────────────────────────────────
/**
 * Parse proxy CLI args and start the proxy.
 *
 * Usage: fuze-ai proxy [options] -- <server-command> [server-args...]
 */
export async function runProxy(argv) {
    // Find the '--' separator
    const sepIdx = argv.indexOf('--');
    if (sepIdx === -1 || sepIdx === argv.length - 1) {
        process.stderr.write('Usage: fuze-ai proxy [options] -- <server-command> [server-args...]\n');
        process.exit(1);
    }
    const proxyArgs = argv.slice(0, sepIdx);
    const serverArgs = argv.slice(sepIdx + 1);
    const serverCommand = serverArgs[0];
    const serverCommandArgs = serverArgs.slice(1);
    // Parse proxy options
    const config = parseProxyArgs(proxyArgs);
    // Build the label shown in logs
    const serverLabel = serverArgs.join(' ');
    // Instantiate components
    const transport = new TransportStdio();
    const bridge = new MCPBridge(serverCommand, serverCommandArgs);
    const interceptor = new ToolInterceptor(config, config.tracePath);
    const router = new ProxyRouter(transport, bridge, interceptor, {
        verbose: config.verbose,
        serverLabel,
    });
    // Spawn the real server
    await bridge.start();
    // Wire up and start routing
    router.start(async (code) => {
        await router.stop();
        process.exit(code ?? 0);
    });
    // Graceful shutdown handlers
    const shutdown = async (signal) => {
        process.stderr.write(`\n[fuze] Received ${signal}\n`);
        await router.stop();
        process.exit(0);
    };
    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
// ── Arg parsing ───────────────────────────────────────────────────────────────
function parseProxyArgs(args) {
    const get = (flag) => {
        const idx = args.indexOf(flag);
        return idx !== -1 ? args[idx + 1] : undefined;
    };
    return {
        maxCostPerRun: get('--max-cost') != null ? Number(get('--max-cost')) : 10.0,
        maxIterations: get('--max-iterations') != null ? Number(get('--max-iterations')) : 50,
        tracePath: get('--trace') ?? './fuze-proxy-traces.jsonl',
        verbose: args.includes('--verbose'),
        daemonSocket: get('--daemon'),
        tools: {},
    };
}
//# sourceMappingURL=index.js.map