import type { ZodType } from 'zod'
import type { AnnexIIIDomain, GdprLawfulBasis, RetentionPolicy } from './compliance.js'
import type { FuzeModel } from './model.js'
import type { AnyFuzeTool } from './tool.js'
import type { GuardrailSet } from './guardrail.js'
import type { FuzeMemory } from './memory.js'
import type { TenantId, PrincipalId } from './brand.js'
import type { SubjectRef } from './compliance.js'
import type { SecretsHandle } from './secrets.js'

export interface OversightPlanRef {
  readonly id: string
  readonly trainingId?: string
}

export type PlanRequirement = boolean | 'auto-when-high-risk'

export interface PlanningConfig {
  readonly required?: PlanRequirement
  readonly minSteps?: number
  readonly maxSteps?: number
}

export interface AgentDefinition<TDeps, TOut> {
  readonly purpose: string
  readonly lawfulBasis: GdprLawfulBasis
  readonly annexIIIDomain: AnnexIIIDomain
  readonly producesArt22Decision: boolean
  readonly art14OversightPlan?: OversightPlanRef
  readonly model: FuzeModel
  readonly tools: readonly AnyFuzeTool[]
  readonly guardrails: GuardrailSet<TDeps>
  readonly memory?: FuzeMemory
  readonly output: ZodType<TOut>
  readonly maxSteps: number
  readonly retryBudget: number
  readonly retention: RetentionPolicy
  readonly deps: TDeps
  /** Behavioral instructions (~150 chars). Distinct from purpose, which is
   *  the Article 13 transparency line. Optional during the migration. */
  readonly instructions?: string
  /** Hash of resolved instructions; set by fromMarkdown() or computed by the runtime. */
  readonly instructionsHash?: string
  /** Co-located markdown context files. Hashed individually for evidence. */
  readonly context?: ReadonlyArray<{ readonly path: string; readonly sha256: string; readonly bytes: number }>
  /** Planning configuration. Default 'auto-when-high-risk' enforced at runtime. */
  readonly planning?: PlanningConfig
  /** Capability envelopes the parent can dispatch into at runtime. */
  readonly canDispatch?: ReadonlyArray<import('./role.js').AnyAgentRole>
}

export interface AgentRunInput {
  readonly tenant: TenantId
  readonly principal: PrincipalId
  readonly subjectRef?: SubjectRef
  readonly secrets: SecretsHandle
  readonly userMessage: string
}

export type AgentRunStatus = 'completed' | 'tripwire' | 'policy-denied' | 'budget-exceeded' | 'error' | 'suspended'

import type { SuspendedRun } from './oversight.js'

export interface AgentRunResult<TOut> {
  readonly status: AgentRunStatus
  readonly output?: TOut
  readonly reason?: string
  readonly runId: string
  readonly steps: number
  readonly evidenceHashChainHead: string
  readonly suspended?: SuspendedRun
}
