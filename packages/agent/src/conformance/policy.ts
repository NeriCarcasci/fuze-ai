import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import type { PolicyEngine } from '../types/policy.js'
import type { Ctx } from '../types/ctx.js'
import type { AnyFuzeTool } from '../types/tool.js'
import type { ThreatBoundary, RetentionPolicy } from '../types/compliance.js'
import { makeRunId, makeStepId, makeTenantId, makePrincipalId } from '../types/brand.js'
import { Ok } from '../types/result.js'

const TB: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

const RET: RetentionPolicy = {
  id: 'conf.v1',
  hashTtlDays: 30,
  fullContentTtlDays: 7,
  decisionTtlDays: 90,
}

const stubTool = (name: string): AnyFuzeTool => ({
  name,
  description: 'stub',
  input: z.object({}),
  output: z.object({}),
  threatBoundary: TB,
  retention: RET,
  dataClassification: 'public',
  run: async () => Ok({}),
})

const stubCtx = (tenant = 't-conf'): Ctx<unknown> => ({
  tenant: makeTenantId(tenant),
  principal: makePrincipalId('p-conf'),
  runId: makeRunId('r-conf'),
  stepId: makeStepId('s-conf'),
  deps: {},
  secrets: {
    ref: () => {
      throw new Error('not used')
    },
    resolve: async () => '',
  },
  attribute: () => undefined,
  invoke: async () => {
    throw new Error('not used')
  },
})

export interface PolicyConformanceOptions {
  readonly factoryWithRules: (allowToolName: string) => PolicyEngine | Promise<PolicyEngine>
  readonly factoryDefaultDeny: () => PolicyEngine | Promise<PolicyEngine>
  readonly factoryRequiringApproval?: (toolName: string) => PolicyEngine | Promise<PolicyEngine>
}

export const runPolicyConformance = (
  name: string,
  opts: PolicyConformanceOptions,
): void => {
  describe(`PolicyEngine conformance: ${name}`, () => {
    it('emits an allow decision for a matching rule', async () => {
      const engine = await opts.factoryWithRules('echo')
      const decision = await engine.evaluate({
        tool: stubTool('echo'),
        args: {},
        ctx: stubCtx(),
      })
      expect(decision.effect).toBe('allow')
    })

    it('default-denies when no rule matches', async () => {
      const engine = await opts.factoryDefaultDeny()
      const decision = await engine.evaluate({
        tool: stubTool('unknown'),
        args: {},
        ctx: stubCtx(),
      })
      expect(decision.effect).toBe('deny')
    })

    it('attaches a policyId to every decision', async () => {
      const engine = await opts.factoryWithRules('echo')
      const decision = await engine.evaluate({
        tool: stubTool('echo'),
        args: {},
        ctx: stubCtx(),
      })
      expect(decision.policyId).toBeDefined()
    })

    const requiringApprovalFactory = opts.factoryRequiringApproval
    if (requiringApprovalFactory) {
      it('emits requires-approval when the rule says so', async () => {
        const engine = await requiringApprovalFactory('approve-me')
        const decision = await engine.evaluate({
          tool: stubTool('approve-me'),
          args: {},
          ctx: stubCtx(),
        })
        expect(decision.effect).toBe('requires-approval')
      })
    }
  })
}
