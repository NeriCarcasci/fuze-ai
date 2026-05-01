import {
  inMemorySecrets,
  makePrincipalId,
  makeTenantId,
  runAgent,
  StaticPolicyEngine,
  type AgentDefinition,
  type AgentRunInput,
  type ChainedRecord,
  type EvidenceSpan,
  type PolicyEngine,
} from '@fuze-ai/agent'
import type {
  Case,
  CaseReport,
  Dataset,
  EvaluationReport,
  Evaluator,
} from './types.js'

export interface RunOptions {
  readonly tenant?: string
  readonly principal?: string
  readonly policy?: PolicyEngine
  readonly buildUserMessage?: (input: unknown) => string
  readonly buildRunInput?: (input: unknown, base: AgentRunInput) => AgentRunInput
}

export interface RunEvaluationDeps<TIn, TOut, TDeps> {
  readonly dataset: Dataset<TIn, TOut>
  readonly agent:
    | AgentDefinition<TDeps, TOut>
    | ((c: Case<TIn, TOut>) => AgentDefinition<TDeps, TOut>)
  readonly evaluators: readonly Evaluator<TIn, TOut>[]
  readonly runOpts?: RunOptions
}

const defaultPolicy = (): PolicyEngine =>
  new StaticPolicyEngine([{ id: 'eval.default.allow', toolName: '*', effect: 'allow' }])

const stringifyInput = (v: unknown): string => {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v)
  } catch {
    return String(v)
  }
}

export const runEvaluation = async <TIn, TOut, TDeps>(
  deps: RunEvaluationDeps<TIn, TOut, TDeps>,
): Promise<EvaluationReport<TIn, TOut>> => {
  const policy = deps.runOpts?.policy ?? defaultPolicy()
  const tenantId = makeTenantId(deps.runOpts?.tenant ?? 'eval-tenant')
  const principalId = makePrincipalId(deps.runOpts?.principal ?? 'eval-principal')
  const buildMsg = deps.runOpts?.buildUserMessage ?? stringifyInput

  const cases: CaseReport<TIn, TOut>[] = []
  let passedCases = 0
  let totalScore = 0

  for (const c of deps.dataset.cases) {
    const records: ChainedRecord<EvidenceSpan>[] = []
    const baseInput: AgentRunInput = {
      tenant: tenantId,
      principal: principalId,
      secrets: inMemorySecrets({}),
      userMessage: buildMsg(c.input),
    }
    const runInput = deps.runOpts?.buildRunInput
      ? deps.runOpts.buildRunInput(c.input, baseInput)
      : baseInput

    const definition =
      typeof deps.agent === 'function' ? deps.agent(c) : deps.agent
    const result = await runAgent(
      {
        definition,
        policy,
        evidenceSink: (r) => {
          records.push(r)
        },
      },
      runInput,
    )

    const actual = result.output as TOut | undefined
    const evalCtx = {
      case: c,
      actualOutput: actual,
      status: result.status,
      records,
    }

    const evResults: { evaluator: string; result: { passed: boolean; score: number; reason?: string; evidence?: Readonly<Record<string, unknown>> } }[] = []
    let allPassed = true
    let scoreSum = 0
    for (const ev of deps.evaluators) {
      const r = await ev.evaluate(evalCtx)
      evResults.push({ evaluator: ev.name, result: r })
      if (!r.passed) allPassed = false
      scoreSum += r.score
    }

    const aggregateScore = deps.evaluators.length === 0 ? 1 : scoreSum / deps.evaluators.length
    if (allPassed) passedCases++
    totalScore += aggregateScore

    cases.push({
      caseId: c.id,
      status: result.status,
      actualOutput: actual,
      results: evResults,
      passed: allPassed,
      aggregateScore,
      recordCount: records.length,
    })
  }

  const totalCases = deps.dataset.cases.length
  return {
    cases,
    passRate: totalCases === 0 ? 1 : passedCases / totalCases,
    averageScore: totalCases === 0 ? 1 : totalScore / totalCases,
    totalCases,
    passedCases,
  }
}
