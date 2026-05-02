import type { ModelGenerateInput, ModelStep } from '@fuze-ai/agent'
import { callOpenAiCompat, type FetchLike } from './openai-compat.js'
import type { ModelProvider } from './residency.js'

export interface MistralModelOptions {
  readonly apiKey: string
  readonly model?: string
  readonly fetchImpl?: FetchLike
}

const MISTRAL_URL = 'https://api.mistral.ai/v1/chat/completions'
const DEFAULT_MODEL = 'mistral-large-latest'

export const mistralModel = (opts: MistralModelOptions): ModelProvider<'eu'> => {
  const modelName = opts.model ?? DEFAULT_MODEL
  const fetchImpl: FetchLike =
    opts.fetchImpl ?? ((url, init) => fetch(url, init))
  return {
    providerName: 'mistral',
    modelName,
    residency: 'eu',
    generate(input: ModelGenerateInput): Promise<ModelStep> {
      return callOpenAiCompat({
        url: MISTRAL_URL,
        apiKey: opts.apiKey,
        modelName,
        input,
        fetchImpl,
      })
    },
  }
}
