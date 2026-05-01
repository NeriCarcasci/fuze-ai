import type {
  AgentRunStatus,
  ChainedRecord,
  EvidenceSpan,
} from '@fuze-ai/agent'

export interface Case<TIn, TOut> {
  readonly id: string
  readonly input: TIn
  readonly expectedOutput?: TOut
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface Dataset<TIn, TOut> {
  readonly cases: readonly Case<TIn, TOut>[]
}

export interface EvaluationContext<TIn, TOut> {
  readonly case: Case<TIn, TOut>
  readonly actualOutput: TOut | undefined
  readonly status: AgentRunStatus
  readonly records: readonly ChainedRecord<EvidenceSpan>[]
}

export interface EvaluationResult {
  readonly passed: boolean
  readonly score: number
  readonly reason?: string
  readonly evidence?: Readonly<Record<string, unknown>>
}

export interface Evaluator<TIn, TOut> {
  readonly name: string
  evaluate(ctx: EvaluationContext<TIn, TOut>): Promise<EvaluationResult>
}

export interface CaseReport<TIn, TOut> {
  readonly caseId: string
  readonly status: AgentRunStatus
  readonly actualOutput: TOut | undefined
  readonly results: readonly { readonly evaluator: string; readonly result: EvaluationResult }[]
  readonly passed: boolean
  readonly aggregateScore: number
  readonly recordCount: number
}

export interface EvaluationReport<TIn, TOut> {
  readonly cases: readonly CaseReport<TIn, TOut>[]
  readonly passRate: number
  readonly averageScore: number
  readonly totalCases: number
  readonly passedCases: number
}
