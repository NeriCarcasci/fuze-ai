import { createRequire } from 'node:module'
import type { ModelGenerateInput, ModelStep } from '@fuze-ai/agent'
import { callOpenAiCompat, type FetchLike } from './openai-compat.js'
import type { ModelProvider } from './residency.js'

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'
const DEFAULT_MODEL = 'gpt-4o-mini'

export class OpenAINotInstalledError extends Error {
  constructor(cause?: unknown) {
    super(
      'openai is not installed. Install it with `npm install openai` to use the openAI provider, or pass `fetchImpl` for direct HTTP.',
    )
    this.name = 'OpenAINotInstalledError'
    if (cause !== undefined) {
      ;(this as { cause?: unknown }).cause = cause
    }
  }
}

export interface OpenAIOptions {
  readonly apiKey: string
  readonly model?: string
  readonly baseURL?: string
  readonly fetchImpl?: FetchLike
  readonly skipSdkProbe?: boolean
}

const probeSdk = (): void => {
  try {
    const req = createRequire(import.meta.url)
    req.resolve('openai')
  } catch (err) {
    throw new OpenAINotInstalledError(err)
  }
}

export const openAI = (opts: OpenAIOptions): ModelProvider<'us'> => {
  if (opts.fetchImpl === undefined && opts.skipSdkProbe !== true) {
    probeSdk()
  }
  const modelName = opts.model ?? DEFAULT_MODEL
  const url = opts.baseURL
    ? `${opts.baseURL.replace(/\/+$/, '')}/chat/completions`
    : OPENAI_URL
  const fetchImpl: FetchLike =
    opts.fetchImpl ?? ((u, init) => fetch(u, init))
  return {
    providerName: 'openai',
    modelName,
    residency: 'us',
    generate(input: ModelGenerateInput): Promise<ModelStep> {
      return callOpenAiCompat({
        url,
        apiKey: opts.apiKey,
        modelName,
        input,
        fetchImpl,
      })
    },
  }
}
