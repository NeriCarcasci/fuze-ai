import type { PrincipalId, RunId, StepId, TenantId } from './brand.js'
import type { SecretsHandle } from './secrets.js'
import type { SubjectRef } from './compliance.js'

export type AttrValue = string | number | boolean | readonly string[]

export interface ToolHandle {
  invoke<TInput, TOutput>(name: string, input: TInput): Promise<TOutput>
}

export interface Ctx<TDeps> {
  readonly tenant: TenantId
  readonly principal: PrincipalId
  readonly runId: RunId
  readonly stepId: StepId
  readonly subjectRef?: SubjectRef
  readonly deps: Readonly<TDeps>
  readonly secrets: SecretsHandle
  attribute(key: string, value: AttrValue): void
  invoke<TInput, TOutput>(name: string, input: TInput): Promise<TOutput>
}

export interface CtxBuildInput<TDeps> {
  readonly tenant: TenantId
  readonly principal: PrincipalId
  readonly runId: RunId
  readonly stepId: StepId
  readonly subjectRef?: SubjectRef
  readonly deps: TDeps
  readonly secrets: SecretsHandle
  readonly attribute: (key: string, value: AttrValue) => void
  readonly invoke: ToolHandle['invoke']
}

export const buildCtx = <TDeps>(input: CtxBuildInput<TDeps>): Ctx<TDeps> => ({
  tenant: input.tenant,
  principal: input.principal,
  runId: input.runId,
  stepId: input.stepId,
  ...(input.subjectRef === undefined ? {} : { subjectRef: input.subjectRef }),
  deps: Object.freeze({ ...input.deps }) as Readonly<TDeps>,
  secrets: input.secrets,
  attribute: input.attribute,
  invoke: input.invoke,
})
