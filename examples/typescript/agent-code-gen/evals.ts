import {
  inMemorySecrets,
  makePrincipalId,
  makeTenantId,
  runAgent,
  type ChainedRecord,
  type EvidenceSpan,
} from '@fuze-ai/agent'
import {
  evidenceContainsEvaluator,
  hashChainValidEvaluator,
  noPiiLeakEvaluator,
  policyDecisionEvaluator,
  schemaShapeEvaluator,
  tokenBudgetEvaluator,
  type Case,
  type EvaluationContext,
  type EvaluationResult,
  type Evaluator,
} from '@fuze-ai/agent-eval'
import { z } from 'zod'
import { buildCodeGenAgent, buildPolicy, type CodegenInput } from './index.ts'

interface CodegenOut {
  readonly task: string
  readonly success: boolean
}

const cases: readonly Case<CodegenInput, CodegenOut>[] = [
  { id: 'add-sub', input: { task: 'add sub fn', path: 'src/add.ts' } },
  { id: 'add-mul', input: { task: 'add mul fn', path: 'src/add.ts' } },
  { id: 'add-div', input: { task: 'add div fn', path: 'src/add.ts' } },
  { id: 'edit-pkg', input: { task: 'edit package.json', path: 'package.json' } },
  { id: 'noop', input: { task: 'no-op refactor', path: 'src/add.ts' } },
]

const completed: Evaluator<CodegenInput, CodegenOut> = {
  name: 'completedSuccessfully',
  async evaluate(ctx: EvaluationContext<CodegenInput, CodegenOut>): Promise<EvaluationResult> {
    return ctx.status === 'completed' && ctx.actualOutput?.success === true
      ? { passed: true, score: 1 }
      : { passed: false, score: 0, reason: `status=${ctx.status} success=${String(ctx.actualOutput?.success)}` }
  },
}

const evaluators: readonly Evaluator<CodegenInput, CodegenOut>[] = [
  completed,
  hashChainValidEvaluator(),
  schemaShapeEvaluator(z.object({ task: z.string(), success: z.boolean() })),
  evidenceContainsEvaluator({ spans: ['agent.invoke', 'tool.execute'] }),
  policyDecisionEvaluator({ expectedEffect: 'allow' }),
  tokenBudgetEvaluator({ maxTokens: 500 }),
  noPiiLeakEvaluator(),
]

const main = async (): Promise<void> => {
  const policy = buildPolicy()
  const reports: { caseId: string; passed: boolean; details: { evaluator: string; passed: boolean; reason?: string }[] }[] = []
  let passedCases = 0

  for (const c of cases) {
    const records: ChainedRecord<EvidenceSpan>[] = []
    const agent = buildCodeGenAgent(c.input)
    const result = await runAgent(
      {
        definition: agent,
        policy,
        evidenceSink: (r) => {
          records.push(r)
        },
      },
      {
        tenant: makeTenantId('dev-prod'),
        principal: makePrincipalId('eval-runner'),
        secrets: inMemorySecrets({}),
        userMessage: c.input.task,
      },
    )

    const ctx: EvaluationContext<CodegenInput, CodegenOut> = {
      case: c,
      actualOutput: result.output as CodegenOut | undefined,
      status: result.status,
      records,
    }
    const details: { evaluator: string; passed: boolean; reason?: string }[] = []
    let allPassed = true
    for (const ev of evaluators) {
      const r = await ev.evaluate(ctx)
      if (!r.passed) allPassed = false
      details.push(r.reason ? { evaluator: ev.name, passed: r.passed, reason: r.reason } : { evaluator: ev.name, passed: r.passed })
    }
    if (allPassed) passedCases++
    reports.push({ caseId: c.id, passed: allPassed, details })
  }

  const passRate = passedCases / cases.length
  console.log(JSON.stringify({ totalCases: cases.length, passedCases, passRate, cases: reports }, null, 2))
  if (passRate < 0.8) {
    console.error(`pass rate ${passRate} below 0.8 threshold`)
    process.exit(1)
  }
}

await main()
