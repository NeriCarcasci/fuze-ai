import type { JsonRpcMessage } from './types.js';
/**
 * Handles JSON-RPC 2.0 stdio transport between the MCP client and the proxy.
 *
 * - Reads newline-delimited JSON from process.stdin (client → proxy)
 * - Writes newline-delimited JSON to process.stdout (proxy → client)
 *
 * IMPORTANT: All proxy logging goes to process.stderr. process.stdout is
 * reserved exclusively for MCP protocol messages to the client.
 */
export declare class TransportStdio {
    private handler;
    private rl;
    /**
     * Register a handler for messages received from the client.
     */
    onClientMessage(handler: (message: JsonRpcMessage) => void): void;
    /**
     * Send a JSON-RPC message to the client.
     */
    sendToClient(message: JsonRpcMessage): void;
    /**
     * Start reading from process.stdin.
     */
    start(): void;
    /**
     * Stop reading from stdin.
     */
    stop(): void;
}
//# sourceMappingURL=transport-stdio.d.ts.map