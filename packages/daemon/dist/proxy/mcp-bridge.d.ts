import type { JsonRpcMessage } from './types.js';
/**
 * Manages the real MCP server as a child process.
 *
 * The bridge spawns the server and establishes stdio pipes:
 * - stdin  → proxy writes messages TO the server
 * - stdout → proxy reads messages FROM the server
 * - stderr → inherited (server errors visible in proxy's terminal)
 */
export declare class MCPBridge {
    private readonly command;
    private readonly args;
    private child;
    private messageHandler;
    private exitHandler;
    constructor(command: string, args: string[]);
    /**
     * Spawn the real server process and begin reading its stdout.
     * Resolves once the process is running.
     */
    start(): Promise<void>;
    /**
     * Write a JSON-RPC message to the server's stdin.
     */
    sendToServer(message: JsonRpcMessage): void;
    /**
     * Register a handler for messages received from the server.
     */
    onServerMessage(handler: (message: JsonRpcMessage) => void): void;
    /**
     * Register a handler for server process exit.
     */
    onServerExit(handler: (code: number | null, signal: string | null) => void): void;
    /**
     * Send SIGTERM; after 3 s send SIGKILL if still alive.
     */
    stop(): Promise<void>;
    /** Returns true if the server process is still running. */
    isAlive(): boolean;
}
//# sourceMappingURL=mcp-bridge.d.ts.map