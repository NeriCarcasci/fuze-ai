import type { FuzeModel, ModelGenerateInput, ModelStep } from '@fuze-ai/agent'
import { callOpenAiCompat, type FetchLike } from './openai-compat.js'

export interface ScalewayModelOptions {
  readonly apiKey: string
  readonly model: string
  readonly projectId: string
  readonly fetchImpl?: FetchLike
}

const buildUrl = (projectId: string): string =>
  `https://api.scaleway.ai/${projectId}/v1/chat/completions`

export const scalewayModel = (opts: ScalewayModelOptions): FuzeModel => {
  const fetchImpl: FetchLike =
    opts.fetchImpl ?? ((url, init) => fetch(url, init))
  const url = buildUrl(opts.projectId)
  return {
    providerName: 'scaleway',
    modelName: opts.model,
    residency: 'eu',
    generate(input: ModelGenerateInput): Promise<ModelStep> {
      return callOpenAiCompat({
        url,
        apiKey: opts.apiKey,
        modelName: opts.model,
        input,
        fetchImpl,
      })
    },
  }
}
