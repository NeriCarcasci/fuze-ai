import type { RunId } from './brand.js'

export type ReplayMode =
  | 'cached-tools-fresh-model'
  | 'cached-everything'
  | 'cached-tools-cached-model'

export type DeterminismVerdict = 'exact' | 'within-tolerance' | 'drifted'

export interface ToolCallDrift {
  readonly cacheKey: string
  readonly originalOutputHash: string
  readonly replayedOutputHash: string
  readonly diffSummary: string
}

export interface ModelCallDrift {
  readonly originalRequestHash: string
  readonly originalResponseHash: string
  readonly replayedResponseHash: string
  readonly modelSnapshotMatched: boolean
  readonly systemFingerprintMatched: boolean
  readonly diffSummary: string
}

export interface PlanDrift {
  readonly originalStepCount: number
  readonly replayedStepCount: number
  readonly addedSteps: readonly string[]
  readonly removedSteps: readonly string[]
  readonly statusDiffs: readonly { readonly stepId: string; readonly original: string; readonly replayed: string }[]
}

export interface OutputDrift {
  readonly originalOutputHash: string
  readonly replayedOutputHash: string
  readonly textualDiff?: string
  readonly semanticEqual?: boolean
}

export interface ReplayResult {
  readonly originalRunId: RunId
  readonly replayRunId: RunId
  readonly mode: ReplayMode
  readonly recursive: boolean
  readonly drift: {
    readonly toolCalls: readonly ToolCallDrift[]
    readonly modelCalls: readonly ModelCallDrift[]
    readonly plan: PlanDrift
    readonly output: OutputDrift
  }
  readonly determinismVerdict: DeterminismVerdict
  readonly spineCompatible: boolean
  readonly originalChainHead: string
  readonly replayChainHead: string
}

export interface ReplayInput {
  readonly mode: ReplayMode
  readonly recursive?: boolean
  readonly tolerateModelDrift?: boolean
}
