import type { ZodType } from 'zod'
import type { AnyFuzeTool } from './tool.js'
import type { GdprLawfulBasis, DataClassification, Residency, RetentionPolicy } from './compliance.js'
import type { AgentErrorCategory } from './dispatch.js'
import type { FuzeMemory } from './memory.js'

export interface RetryPolicy {
  readonly maxAttempts: number
  readonly on: readonly AgentErrorCategory[]
  readonly backoff?: { readonly type: 'fixed' | 'exp'; readonly baseMs: number }
  readonly budgetMode: 'per-dispatch' | 'per-run'
}

export interface OutputViews {
  readonly [viewName: string]: ZodType<unknown>
}

export interface AgentRoleDefinition<TBaseOut = unknown, TViews extends OutputViews = OutputViews> {
  readonly name: string
  readonly instructions: string
  readonly instructionsHash: string
  readonly context: ReadonlyArray<{ readonly path: string; readonly sha256: string; readonly bytes: number }>
  readonly tools: readonly AnyFuzeTool[]
  readonly dataClassification: DataClassification | 'inherit-from-parent'
  readonly lawfulBasis: GdprLawfulBasis | null
  readonly residency: Residency | null
  readonly outputSchema: ZodType<TBaseOut>
  readonly outputViews: TViews
  readonly maxSteps: number
  readonly retry?: RetryPolicy
  readonly retention: RetentionPolicy
  readonly requiresPrincipal: boolean
  /** When true, dispatch to this role fails closed if the parent's
   *  context has no tenant. Auto-forwards tenant when the parent has one. */
  readonly requiresTenant: boolean
  readonly memory?: FuzeMemory
  readonly roleHash: string
}

export type AnyAgentRole = AgentRoleDefinition<unknown, OutputViews>

export interface DefineAgentRoleInput<TBaseOut, TViews extends OutputViews = OutputViews> {
  readonly name: string
  readonly instructions: string | { readonly resolved: string; readonly sha256: string }
  readonly context?: ReadonlyArray<{ readonly path: string; readonly sha256: string; readonly bytes: number }>
  readonly tools: readonly AnyFuzeTool[]
  readonly dataClassification: DataClassification | 'inherit-from-parent'
  readonly lawfulBasis?: GdprLawfulBasis | null
  readonly residency?: Residency | null
  readonly outputSchema: ZodType<TBaseOut>
  readonly outputViews?: TViews
  readonly maxSteps?: number
  readonly retry?: RetryPolicy
  readonly retention?: RetentionPolicy
  readonly requiresPrincipal?: boolean
  readonly requiresTenant?: boolean
  readonly memory?: FuzeMemory
}
