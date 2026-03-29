import { ToolInterceptor } from './tool-interceptor.js';
import type { JsonRpcMessage } from './types.js';
/**
 * Core message-routing logic. Separated from startup/shutdown so it is
 * testable without real stdio or child processes.
 */
export declare class ProxyRouter {
    private readonly transport;
    private readonly bridge;
    private readonly interceptor;
    private readonly opts;
    private readonly pendingMethods;
    constructor(transport: {
        onClientMessage: (h: (m: JsonRpcMessage) => void) => void;
        sendToClient: (m: JsonRpcMessage) => void;
        start: () => void;
        stop: () => void;
    }, bridge: {
        onServerMessage: (h: (m: JsonRpcMessage) => void) => void;
        onServerExit: (h: (code: number | null, signal: string | null) => void) => void;
        sendToServer: (m: JsonRpcMessage) => void;
        stop: () => Promise<void>;
    }, interceptor: ToolInterceptor, opts: {
        verbose: boolean;
        serverLabel: string;
    });
    /** Wire up message handlers and begin routing. */
    start(onServerExit?: (code: number | null) => void | Promise<void>): void;
    /** Graceful shutdown. */
    stop(): Promise<void>;
    private _handleClientMessage;
    private _handleServerMessage;
}
/**
 * Parse proxy CLI args and start the proxy.
 *
 * Usage: fuze-ai proxy [options] -- <server-command> [server-args...]
 */
export declare function runProxy(argv: string[]): Promise<void>;
//# sourceMappingURL=index.d.ts.map