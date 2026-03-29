import { createInterface } from 'node:readline';
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
    handler = null;
    rl = null;
    /**
     * Register a handler for messages received from the client.
     */
    onClientMessage(handler) {
        this.handler = handler;
    }
    /**
     * Send a JSON-RPC message to the client.
     */
    sendToClient(message) {
        process.stdout.write(JSON.stringify(message) + '\n');
    }
    /**
     * Start reading from process.stdin.
     */
    start() {
        this.rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
        this.rl.on('line', (line) => {
            const trimmed = line.trim();
            if (!trimmed)
                return;
            try {
                const msg = JSON.parse(trimmed);
                this.handler?.(msg);
            }
            catch {
                process.stderr.write(`[fuze] Non-JSON from client, skipping: ${trimmed.slice(0, 100)}\n`);
            }
        });
    }
    /**
     * Stop reading from stdin.
     */
    stop() {
        this.rl?.close();
        this.rl = null;
    }
}
//# sourceMappingURL=transport-stdio.js.map