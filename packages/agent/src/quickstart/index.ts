import { z, type ZodType } from 'zod'
import { defineTool } from '../agent/define-tool.js'
import { defineAgent } from '../agent/define-agent.js'
import { runAgent } from '../loop/loop.js'
import { inMemorySecrets } from '../agent/secrets-noop.js'
import { StaticPolicyEngine } from '../policy/static.js'
import { makeTenantId, makePrincipalId } from '../types/brand.js'
import { Ok } from '../types/result.js'
import type { FuzeModel } from '../types/model.js'
import type { AgentRunResult } from '../types/agent.js'
import type { PublicTool } from '../types/tool.js'
import type { ChainedRecord } from '../evidence/hash-chain.js'
import type { EvidenceSpan } from '../evidence/emitter.js'
import type { ThreatBoundary, RetentionPolicy } from '../types/compliance.js'

const QUICK_THREAT_BOUNDARY: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

const QUICK_RETENTION: RetentionPolicy = {
  id: 'fuze.quickstart.v1',
  hashTtlDays: 7,
  fullContentTtlDays: 1,
  decisionTtlDays: 30,
}

export interface QuickToolSpec<TIn, TOut> {
  readonly name: string
  readonly description: string
  readonly input: ZodType<TIn>
  readonly output: ZodType<TOut>
  readonly run: (input: TIn) => Promise<TOut> | TOut
}

export type QuickTool<TIn = unknown, TOut = unknown> = PublicTool<TIn, TOut, unknown>

export const quickTool = <TIn, TOut>(
  spec: QuickToolSpec<TIn, TOut>,
): QuickTool<TIn, TOut> =>
  defineTool.public<TIn, TOut, unknown>({
    name: spec.name,
    description: spec.description,
    input: spec.input,
    output: spec.output,
    threatBoundary: QUICK_THREAT_BOUNDARY,
    retention: QUICK_RETENTION,
    run: async (input) => Ok(await spec.run(input)),
  })

export interface QuickAgentSpecBase {
  readonly model: FuzeModel
  readonly tools: readonly QuickTool[]
  readonly maxSteps?: number
  readonly system?: string
  readonly captureFullContent?: boolean
  readonly onEvidence?: (record: ChainedRecord<EvidenceSpan>) => void
}

export interface QuickAgentSpec<TOut> extends QuickAgentSpecBase {
  readonly output: ZodType<TOut>
}

export interface QuickAgent<TOut> {
  run(userMessage: string): Promise<AgentRunResult<TOut>>
  records(): readonly ChainedRecord<EvidenceSpan>[]
}

const defaultOutputSchema: ZodType<{ answer: string }> = z.object({ answer: z.string() })

let warned = false
const warnOnce = (): void => {
  if (warned) return
  warned = true
  // eslint-disable-next-line no-console
  console.warn(
    '[fuze-quickstart] using default allow-all policy; for production, define a real PolicyEngine',
  )
}

const buildQuickAgent = <TOut>(
  output: ZodType<TOut>,
  spec: QuickAgentSpecBase,
): QuickAgent<TOut> => {
  const records: ChainedRecord<EvidenceSpan>[] = []
  const policy = new StaticPolicyEngine([
    { id: 'fuze.quickstart.allow_all', toolName: '*', effect: 'allow' },
  ])
  const buildUserMessage = (msg: string): string =>
    spec.system ? `${spec.system}\n\n${msg}` : msg

  return {
    async run(userMessage) {
      warnOnce()
      const definition = defineAgent<unknown, TOut>({
        purpose: 'fuze-quickstart',
        lawfulBasis: 'consent',
        annexIIIDomain: 'none',
        producesArt22Decision: false,
        model: spec.model,
        tools: spec.tools,
        output,
        maxSteps: spec.maxSteps ?? 10,
        retryBudget: 0,
        retention: QUICK_RETENTION,
        deps: {},
      })
      return runAgent<unknown, TOut>(
        {
          definition,
          policy,
          captureFullContent: spec.captureFullContent ?? false,
          evidenceSink: (r) => {
            records.push(r)
            if (spec.onEvidence) spec.onEvidence(r)
          },
        },
        {
          tenant: makeTenantId('quickstart-tenant'),
          principal: makePrincipalId('quickstart-user'),
          secrets: inMemorySecrets({}),
          userMessage: buildUserMessage(userMessage),
        },
      )
    },
    records() {
      return records
    },
  }
}

export function quickAgent(spec: QuickAgentSpecBase): QuickAgent<{ answer: string }>
export function quickAgent<TOut>(spec: QuickAgentSpec<TOut>): QuickAgent<TOut>
export function quickAgent<TOut>(
  spec: QuickAgentSpecBase | QuickAgentSpec<TOut>,
): QuickAgent<TOut> | QuickAgent<{ answer: string }> {
  if ('output' in spec && spec.output) {
    return buildQuickAgent<TOut>(spec.output, spec)
  }
  return buildQuickAgent<{ answer: string }>(defaultOutputSchema, spec)
}
