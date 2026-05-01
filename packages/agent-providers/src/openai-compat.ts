import type {
  AnyFuzeTool,
  ModelGenerateInput,
  ModelMessage,
  ModelStep,
  ToolCallRequest,
} from '@fuze-ai/agent'

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export interface JsonSchemaObject {
  readonly type: 'object'
  readonly properties: Readonly<Record<string, JsonSchemaLeaf>>
  readonly required: readonly string[]
}

export interface JsonSchemaLeaf {
  readonly type: 'string' | 'number' | 'boolean' | 'object'
  readonly properties?: Readonly<Record<string, JsonSchemaLeaf>>
  readonly required?: readonly string[]
}

export interface OpenAiToolDef {
  readonly type: 'function'
  readonly function: {
    readonly name: string
    readonly description: string
    readonly parameters: JsonSchemaObject
  }
}

export interface OpenAiChatMessage {
  readonly role: 'system' | 'user' | 'assistant' | 'tool'
  readonly content: string
  readonly tool_call_id?: string
  readonly name?: string
}

export interface OpenAiChatRequest {
  readonly model: string
  readonly messages: readonly OpenAiChatMessage[]
  readonly tools?: readonly OpenAiToolDef[]
  readonly max_tokens?: number
}

interface ZodLikeDef {
  readonly typeName?: string
  readonly innerType?: ZodLike
}

interface ZodLike {
  readonly _def?: ZodLikeDef
  readonly shape?: Record<string, ZodLike>
  isOptional?(): boolean
}

const isZodLike = (v: unknown): v is ZodLike =>
  typeof v === 'object' && v !== null && '_def' in v

const typeNameOf = (z: ZodLike): string | undefined => z._def?.typeName

const unwrapOptional = (z: ZodLike): ZodLike => {
  if (typeNameOf(z) === 'ZodOptional' && z._def?.innerType) {
    return z._def.innerType
  }
  return z
}

const leafFor = (z: ZodLike): JsonSchemaLeaf => {
  const inner = unwrapOptional(z)
  const tn = typeNameOf(inner)
  if (tn === 'ZodString') return { type: 'string' }
  if (tn === 'ZodNumber') return { type: 'number' }
  if (tn === 'ZodBoolean') return { type: 'boolean' }
  if (tn === 'ZodObject') return zodObjectToSchema(inner)
  throw new Error(`openai-compat: unsupported zod type ${tn ?? 'unknown'}`)
}

const zodObjectToSchema = (z: ZodLike): JsonSchemaObject => {
  if (typeNameOf(z) !== 'ZodObject' || !z.shape) {
    throw new Error('openai-compat: tool input must be a z.object(...)')
  }
  const properties: Record<string, JsonSchemaLeaf> = {}
  const required: string[] = []
  for (const [key, raw] of Object.entries(z.shape)) {
    if (!isZodLike(raw)) continue
    properties[key] = leafFor(raw)
    const optional =
      typeof raw.isOptional === 'function' ? raw.isOptional() : typeNameOf(raw) === 'ZodOptional'
    if (!optional) required.push(key)
  }
  return { type: 'object', properties, required }
}

export const toolToOpenAi = (tool: AnyFuzeTool): OpenAiToolDef => {
  const input = tool.input as unknown as ZodLike
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: zodObjectToSchema(input),
    },
  }
}

const messageToOpenAi = (m: ModelMessage): OpenAiChatMessage => {
  const out: { -readonly [K in keyof OpenAiChatMessage]: OpenAiChatMessage[K] } = {
    role: m.role,
    content: m.content,
  }
  if (m.toolCallId !== undefined) out.tool_call_id = m.toolCallId
  if (m.name !== undefined) out.name = m.name
  return out
}

export const buildChatRequest = (
  modelName: string,
  input: ModelGenerateInput,
): OpenAiChatRequest => {
  const req: {
    -readonly [K in keyof OpenAiChatRequest]: OpenAiChatRequest[K]
  } = {
    model: modelName,
    messages: input.messages.map(messageToOpenAi),
  }
  if (input.tools.length > 0) req.tools = input.tools.map(toolToOpenAi)
  if (input.maxOutputTokens !== undefined) req.max_tokens = input.maxOutputTokens
  return req
}

interface OpenAiToolCall {
  readonly id?: string
  readonly type?: string
  readonly function?: {
    readonly name?: string
    readonly arguments?: string
  }
}

interface OpenAiChoice {
  readonly finish_reason?: string
  readonly message?: {
    readonly content?: string | null
    readonly tool_calls?: readonly OpenAiToolCall[]
  }
}

interface OpenAiUsage {
  readonly prompt_tokens?: number
  readonly completion_tokens?: number
}

interface OpenAiChatResponse {
  readonly choices?: readonly OpenAiChoice[]
  readonly usage?: OpenAiUsage
}

const mapFinishReason = (raw: string | undefined): ModelStep['finishReason'] => {
  switch (raw) {
    case 'stop':
      return 'stop'
    case 'tool_calls':
    case 'function_call':
      return 'tool_calls'
    case 'length':
      return 'length'
    case 'content_filter':
      return 'content_filter'
    default:
      return 'stop'
  }
}

const parseToolCall = (tc: OpenAiToolCall, idx: number): ToolCallRequest => {
  const id = tc.id ?? `call_${idx}`
  const name = tc.function?.name ?? ''
  const rawArgs = tc.function?.arguments ?? '{}'
  let parsed: unknown
  try {
    parsed = JSON.parse(rawArgs)
  } catch {
    parsed = {}
  }
  const args =
    typeof parsed === 'object' && parsed !== null
      ? (parsed as Record<string, unknown>)
      : {}
  return { id, name, args }
}

export const parseChatResponse = (raw: unknown): ModelStep => {
  const data = (raw ?? {}) as OpenAiChatResponse
  const choice = data.choices?.[0]
  const message = choice?.message
  const toolCalls = (message?.tool_calls ?? []).map(parseToolCall)
  return {
    content: message?.content ?? '',
    toolCalls,
    finishReason: mapFinishReason(choice?.finish_reason),
    tokensIn: data.usage?.prompt_tokens ?? 0,
    tokensOut: data.usage?.completion_tokens ?? 0,
  }
}

export interface OpenAiCompatCallOptions {
  readonly url: string
  readonly apiKey: string
  readonly modelName: string
  readonly input: ModelGenerateInput
  readonly fetchImpl: FetchLike
  readonly extraHeaders?: Readonly<Record<string, string>>
}

export const callOpenAiCompat = async (
  opts: OpenAiCompatCallOptions,
): Promise<ModelStep> => {
  const body = buildChatRequest(opts.modelName, opts.input)
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    authorization: `Bearer ${opts.apiKey}`,
  }
  if (opts.extraHeaders) {
    for (const [k, v] of Object.entries(opts.extraHeaders)) headers[k] = v
  }
  const res = await opts.fetchImpl(opts.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`openai-compat: HTTP ${res.status} ${text}`)
  }
  const json: unknown = await res.json()
  return parseChatResponse(json)
}
