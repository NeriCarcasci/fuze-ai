export interface JsonRpcRequest {
  readonly jsonrpc: '2.0'
  readonly id: number | string | null
  readonly method: string
  readonly params?: Readonly<Record<string, unknown>>
}

export interface JsonRpcError {
  readonly code: number
  readonly message: string
  readonly data?: unknown
}

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0'
  readonly id: number | string | null
  readonly result?: unknown
  readonly error?: JsonRpcError
}

export type JsonRpcHandler = (req: JsonRpcRequest) => Promise<JsonRpcResponse>

export interface McpServerTransport {
  start(handler: JsonRpcHandler): Promise<void>
  stop(): Promise<void>
}

export const JSON_RPC_ERR = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  InternalError: -32603,
  PolicyDenied: -32000,
  PolicyEngineError: -32001,
  ToolRefused: -32002,
  ToolExecutionError: -32003,
} as const
