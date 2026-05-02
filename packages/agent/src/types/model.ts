import type { AnyFuzeTool } from './tool.js'

export interface ModelMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content: string
  readonly toolCallId?: string
  readonly name?: string
}

export interface ToolCallRequest {
  readonly id: string
  readonly name: string
  readonly args: Readonly<Record<string, unknown>>
}

export interface ModelStep {
  readonly content: string
  readonly toolCalls: readonly ToolCallRequest[]
  readonly finishReason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'error'
  readonly tokensIn: number
  readonly tokensOut: number
}

export interface FuzeModel {
  readonly providerName: string
  readonly modelName: string
  readonly residency: 'eu' | 'us' | 'multi' | 'unknown'
  generate(input: ModelGenerateInput): Promise<ModelStep>
}

export interface ModelGenerateInput {
  readonly messages: readonly ModelMessage[]
  readonly tools: readonly AnyFuzeTool[]
  readonly maxOutputTokens?: number
}
