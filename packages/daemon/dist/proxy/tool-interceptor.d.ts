import type { JsonRpcErrorObject, McpTool, ProxyConfig, ToolCallMessage, ToolCallResult } from './types.js';
export interface InterceptResult {
    action: 'forward';
    message: ToolCallMessage;
    estimatedCost: number;
    argsHash: string;
}
export interface BlockResult {
    action: 'block';
    response: {
        jsonrpc: '2.0';
        id: number | string;
        error: JsonRpcErrorObject;
    };
}
export type InterceptDecision = InterceptResult | BlockResult;
/**
 * Applies Fuze's guard logic to every `tools/call` request.
 *
 * Checks (in order):
 * 1. Max iterations (LoopDetector layer 1)
 * 2. Repeated tool+args (LoopDetector layer 2)
 * 3. Budget ceiling (ProxyBudget)
 *
 * Returns `{ action: "forward" }` to pass the call through, or
 * `{ action: "block" }` with a JSON-RPC error response.
 */
export declare class ToolInterceptor {
    private readonly config;
    private readonly tracePath;
    private readonly toolConfig;
    private readonly budget;
    private readonly loopDetector;
    private availableTools;
    private readonly pendingCalls;
    private readonly runId;
    private totalCalls;
    private blockedCalls;
    private readonly callCounts;
    constructor(config: ProxyConfig, tracePath: string);
    /**
     * Cache the available tools from a `tools/list` response.
     */
    setAvailableTools(tools: McpTool[]): void;
    /**
     * Intercept a `tools/call` message.
     */
    intercept(message: ToolCallMessage): Promise<InterceptDecision>;
    /**
     * Record the result of a successful tool call (after response from server).
     */
    recordResult(toolName: string, callId: number | string, result: ToolCallResult): void;
    /** Returns current run statistics. */
    getStats(): {
        totalCalls: number;
        totalCost: number;
        blockedCalls: number;
    };
    private _block;
    private _appendTrace;
}
//# sourceMappingURL=tool-interceptor.d.ts.map