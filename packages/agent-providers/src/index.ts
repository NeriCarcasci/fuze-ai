export { mistralModel } from './mistral.js'
export type { MistralModelOptions } from './mistral.js'

export { scalewayModel } from './scaleway.js'
export type { ScalewayModelOptions } from './scaleway.js'

export { ovhModel } from './ovh.js'
export type { OvhModelOptions } from './ovh.js'

export { openAI, OpenAINotInstalledError } from './openai.js'
export type { OpenAIOptions } from './openai.js'

export { anthropic, AnthropicNotInstalledError } from './anthropic.js'
export type { AnthropicOptions, AnthropicRegion } from './anthropic.js'

export type {
  ProviderResidency,
  ModelProvider,
  ToolDataClass,
  RequiresEuResidency,
  CompatibleProvider,
  ToolsCompatibleWith,
} from './residency.js'

export type { FetchLike } from './openai-compat.js'
