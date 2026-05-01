import type { FuzeModel, ModelGenerateInput, ModelStep } from '@fuze-ai/agent'
import { callOpenAiCompat, type FetchLike } from './openai-compat.js'

export interface OvhModelOptions {
  readonly apiKey: string
  readonly modelEndpoint: string
  readonly model?: string
  readonly fetchImpl?: FetchLike
}

const deriveModelName = (endpoint: string): string => {
  try {
    const u = new URL(endpoint)
    const host = u.hostname.split('.')[0] ?? 'ovh'
    return host
  } catch {
    return 'ovh'
  }
}

export const ovhModel = (opts: OvhModelOptions): FuzeModel => {
  const fetchImpl: FetchLike =
    opts.fetchImpl ?? ((url, init) => fetch(url, init))
  const modelName = opts.model ?? deriveModelName(opts.modelEndpoint)
  return {
    providerName: 'ovh',
    modelName,
    residency: 'eu',
    generate(input: ModelGenerateInput): Promise<ModelStep> {
      return callOpenAiCompat({
        url: opts.modelEndpoint,
        apiKey: opts.apiKey,
        modelName,
        input,
        fetchImpl,
      })
    },
  }
}
