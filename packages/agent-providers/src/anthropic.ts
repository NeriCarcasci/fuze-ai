import { createRequire } from 'node:module'
import type {
  AnyFuzeTool,
  ModelGenerateInput,
  ModelMessage,
  ModelStep,
  ToolCallRequest,
} from '@fuze-ai/agent'
import { type FetchLike, toolToOpenAi } from './openai-compat.js'
import type { ModelProvider, ProviderResidency } from './residency.js'

const ANTHROPIC_URL_US = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_URL_EU = 'https://api.eu.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_MODEL = 'claude-sonnet-4-7'
const DEFAULT_MAX_TOKENS = 4096

export class AnthropicNotInstalledError extends Error {
  constructor(cause?: unknown) {
    super(
      '@anthropic-ai/sdk is not installed. Install it with `npm install @anthropic-ai/sdk` to use the anthropic provider, or pass `fetchImpl` for direct HTTP.',
    )
    this.name = 'AnthropicNotInstalledError'
    if (cause !== undefined) {
      ;(this as { cause?: unknown }).cause = cause
    }
  }
}

export type AnthropicRegion = 'us' | 'eu'

export interface AnthropicOptions<R extends AnthropicRegion = AnthropicRegion> {
  readonly apiKey: string
  readonly region: R
  readonly model?: string
  readonly maxTokens?: number
  readonly fetchImpl?: FetchLike
  readonly skipSdkProbe?: boolean
}

interface AnthropicTextBlock {
  readonly type: 'text'
  readonly text: string
}

interface AnthropicToolUseBlock {
  readonly type: 'tool_use'
  readonly id: string
  readonly name: string
  readonly input: Record<string, unknown>
}

interface AnthropicToolResultBlock {
  readonly type: 'tool_result'
  readonly tool_use_id: string
  readonly content: string
}

type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock

interface AnthropicMessage {
  readonly role: 'user' | 'assistant'
  readonly content: readonly AnthropicContentBlock[]
}

interface AnthropicToolDef {
  readonly name: string
  readonly description: string
  readonly input_schema: ReturnType<typeof toolToOpenAi>['function']['parameters']
}

interface AnthropicRequestBody {
  readonly model: string
  readonly max_tokens: number
  readonly system?: string
  readonly messages: readonly AnthropicMessage[]
  readonly tools?: readonly AnthropicToolDef[]
}

interface AnthropicResponseUsage {
  readonly input_tokens?: number
  readonly output_tokens?: number
}

interface AnthropicResponseBody {
  readonly content?: readonly AnthropicContentBlock[]
  readonly stop_reason?: string
  readonly usage?: AnthropicResponseUsage
}

const probeSdk = (): void => {
  try {
    const req = createRequire(import.meta.url)
    req.resolve('@anthropic-ai/sdk')
  } catch (err) {
    throw new AnthropicNotInstalledError(err)
  }
}

const toAnthropicTool = (tool: AnyFuzeTool): AnthropicToolDef => {
  const compat = toolToOpenAi(tool)
  return {
    name: compat.function.name,
    description: compat.function.description,
    input_schema: compat.function.parameters,
  }
}

const partitionMessages = (
  messages: readonly ModelMessage[],
): { system: string | undefined; rest: readonly ModelMessage[] } => {
  let system: string | undefined
  const rest: ModelMessage[] = []
  for (const m of messages) {
    if (m.role === 'system') {
      system = system === undefined ? m.content : `${system}\n${m.content}`
      continue
    }
    rest.push(m)
  }
  return { system, rest }
}

const messageToAnthropic = (m: ModelMessage): AnthropicMessage => {
  if (m.role === 'tool') {
    return {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: m.toolCallId ?? '',
          content: m.content,
        },
      ],
    }
  }
  if (m.role === 'assistant') {
    return { role: 'assistant', content: [{ type: 'text', text: m.content }] }
  }
  return { role: 'user', content: [{ type: 'text', text: m.content }] }
}

const buildRequest = (
  modelName: string,
  maxTokens: number,
  input: ModelGenerateInput,
): AnthropicRequestBody => {
  const { system, rest } = partitionMessages(input.messages)
  const body: {
    -readonly [K in keyof AnthropicRequestBody]: AnthropicRequestBody[K]
  } = {
    model: modelName,
    max_tokens: input.maxOutputTokens ?? maxTokens,
    messages: rest.map(messageToAnthropic),
  }
  if (system !== undefined) body.system = system
  if (input.tools.length > 0) body.tools = input.tools.map(toAnthropicTool)
  return body
}

const mapStopReason = (raw: string | undefined): ModelStep['finishReason'] => {
  switch (raw) {
    case 'end_turn':
    case 'stop_sequence':
      return 'stop'
    case 'tool_use':
      return 'tool_calls'
    case 'max_tokens':
      return 'length'
    default:
      return 'stop'
  }
}

const parseResponse = (raw: unknown): ModelStep => {
  const data = (raw ?? {}) as AnthropicResponseBody
  const blocks = data.content ?? []
  let text = ''
  const toolCalls: ToolCallRequest[] = []
  for (const block of blocks) {
    if (block.type === 'text') {
      text += block.text
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        args: block.input,
      })
    }
  }
  return {
    content: text,
    toolCalls,
    finishReason: mapStopReason(data.stop_reason),
    tokensIn: data.usage?.input_tokens ?? 0,
    tokensOut: data.usage?.output_tokens ?? 0,
  }
}

export function anthropic(opts: AnthropicOptions<'eu'>): ModelProvider<'eu'>
export function anthropic(opts: AnthropicOptions<'us'>): ModelProvider<'us'>
export function anthropic<R extends AnthropicRegion>(
  opts: AnthropicOptions<R>,
): ModelProvider<R> {
  if (opts.fetchImpl === undefined && opts.skipSdkProbe !== true) {
    probeSdk()
  }
  const modelName = opts.model ?? DEFAULT_MODEL
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS
  const url = opts.region === 'eu' ? ANTHROPIC_URL_EU : ANTHROPIC_URL_US
  const fetchImpl: FetchLike =
    opts.fetchImpl ?? ((u, init) => fetch(u, init))
  const residency: ProviderResidency = opts.region === 'eu' ? 'eu' : 'us'
  return {
    providerName: 'anthropic',
    modelName,
    residency: residency as R,
    async generate(input: ModelGenerateInput): Promise<ModelStep> {
      const body = buildRequest(modelName, maxTokens, input)
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': opts.apiKey,
          'anthropic-version': ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`anthropic: HTTP ${res.status} ${text}`)
      }
      const json: unknown = await res.json()
      return parseResponse(json)
    },
  }
}
