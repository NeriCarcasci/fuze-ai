/** MCP / JSON-RPC 2.0 protocol types for the Fuze proxy. */

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number | string
  method: string
  params?: unknown
}

export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: number | string
  result?: unknown
  error?: JsonRpcErrorObject
}

export interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification

export interface JsonRpcErrorObject {
  code: number
  message: string
  data?: unknown
}

// ── MCP-specific types ────────────────────────────────────────────────────────

export interface McpTool {
  name: string
  description?: string
  inputSchema: object
}

export interface ToolCallParams {
  name: string
  arguments: Record<string, unknown>
}

export interface ToolCallMessage extends JsonRpcRequest {
  method: 'tools/call'
  params: ToolCallParams
}

export interface ToolCallResult {
  content: Array<{ type: string; text?: string }>
  isError?: boolean
}

// ── Proxy configuration ───────────────────────────────────────────────────────

export interface ProxyConfig {
  maxTokensPerRun: number
  maxIterations: number
  tracePath: string
  verbose: boolean
  daemonSocket?: string
  tools: ProxyToolsConfig
}

export interface ProxyToolsConfig {
  [toolName: string]: Partial<ToolRawConfig> | undefined
}

export interface ToolRawConfig {
  /** Estimated tokens per call. Default 0. */
  estimated_tokens: number
  side_effect: boolean
  max_calls_per_run: number
  timeout: number
  /** Model identifier used for usage accounting from response payloads. */
  model: string
}

// ── Type guards ───────────────────────────────────────────────────────────────

export function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return 'id' in msg && 'method' in msg
}

export function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return 'id' in msg && !('method' in msg)
}

export function isToolCall(msg: JsonRpcMessage): msg is ToolCallMessage {
  return isRequest(msg) && msg.method === 'tools/call'
}
