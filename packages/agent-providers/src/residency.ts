import type { FuzeModel } from '@fuze-ai/agent'

export type ProviderResidency = 'eu' | 'us' | 'multi'

export interface ModelProvider<R extends ProviderResidency = ProviderResidency>
  extends FuzeModel {
  readonly residency: R
}

export interface ToolDataClass {
  readonly dataClassification: 'public' | 'business' | 'personal' | 'special-category'
}

export type RequiresEuResidency<T extends ToolDataClass> =
  T['dataClassification'] extends 'special-category' ? true
  : T['dataClassification'] extends 'personal' ? true
  : false

export type CompatibleProvider<T extends ToolDataClass> =
  RequiresEuResidency<T> extends true ? ModelProvider<'eu'> : ModelProvider<ProviderResidency>

export type ToolsCompatibleWith<R extends ProviderResidency, Tools extends readonly ToolDataClass[]> =
  R extends 'eu' ? Tools
  : { [K in keyof Tools]: RequiresEuResidency<Tools[K]> extends true ? never : Tools[K] }
