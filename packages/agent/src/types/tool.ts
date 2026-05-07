import type { ZodType } from 'zod'
import type {
  Art9Basis,
  DataClassification,
  GdprLawfulBasis,
  RetentionPolicy,
  ThreatBoundary,
  TrustedInputOnly,
  Residency,
} from './compliance.js'
import type { Result, Retryable } from './result.js'
import type { Ctx } from './ctx.js'

interface BaseTool<TIn, TOut, TDeps> {
  readonly name: string
  readonly description: string
  readonly input: ZodType<TIn>
  readonly output: ZodType<TOut>
  readonly threatBoundary: ThreatBoundary
  readonly retention: RetentionPolicy
  readonly allowedLawfulBases?: readonly GdprLawfulBasis[]
  readonly trustedInputOnly?: TrustedInputOnly
  readonly needsApproval?: (input: TIn, ctx: Ctx<TDeps>) => boolean | Promise<boolean>
  readonly run: (input: TIn, ctx: Ctx<TDeps>) => Promise<Result<TOut, Retryable | Error>>
  /** Soft-cancel grace period when an operator stops the run mid-tool.
   *  Tools know their own I/O profile: a "send_email" should declare ~30s,
   *  "search_docs" ~2s. Default 10000ms (10s). After this elapses, the
   *  tool is hard-killed and a cancellation_truncated evidence row is emitted. */
  readonly softCancelTimeoutMs?: number
  /** Implementation hash for replay. Optional now; recommended for
   *  evidence-graded runs. When absent, the runtime computes a best-effort
   *  hash from the tool's name + version. */
  readonly toolImplHash?: string
  /** Semver of the tool implementation for evidence audit. */
  readonly toolVersion?: string
}

export interface PublicTool<TIn = unknown, TOut = unknown, TDeps = unknown>
  extends BaseTool<TIn, TOut, TDeps> {
  readonly dataClassification: 'public'
}

export interface PersonalTool<TIn = unknown, TOut = unknown, TDeps = unknown>
  extends BaseTool<TIn, TOut, TDeps> {
  readonly dataClassification: 'personal' | 'business'
  readonly residencyRequired: Residency
  readonly allowedLawfulBases: readonly GdprLawfulBasis[]
}

export interface SpecialCategoryTool<TIn = unknown, TOut = unknown, TDeps = unknown>
  extends BaseTool<TIn, TOut, TDeps> {
  readonly dataClassification: 'special-category'
  readonly residencyRequired: 'eu'
  readonly allowedLawfulBases: readonly GdprLawfulBasis[]
  readonly art9Basis: Art9Basis
}

export type FuzeTool<TIn = unknown, TOut = unknown, TDeps = unknown> =
  | PublicTool<TIn, TOut, TDeps>
  | PersonalTool<TIn, TOut, TDeps>
  | SpecialCategoryTool<TIn, TOut, TDeps>

export type AnyFuzeTool = FuzeTool<unknown, unknown, unknown>

export const toolClassification = (t: AnyFuzeTool): DataClassification => t.dataClassification

export const requiresEuResidency = (t: AnyFuzeTool): boolean => {
  if (t.dataClassification === 'public') return false
  if (t.dataClassification === 'special-category') return true
  return t.residencyRequired === 'eu'
}
