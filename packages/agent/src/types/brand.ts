declare const brand: unique symbol

export type Brand<T, B extends string> = T & { readonly [brand]: B }

export type TenantId = Brand<string, 'TenantId'>
export type PrincipalId = Brand<string, 'PrincipalId'>
export type RunId = Brand<string, 'RunId'>
export type StepId = Brand<string, 'StepId'>

export const makeTenantId = (raw: string): TenantId => raw as TenantId
export const makePrincipalId = (raw: string): PrincipalId => raw as PrincipalId
export const makeRunId = (raw: string): RunId => raw as RunId
export const makeStepId = (raw: string): StepId => raw as StepId
