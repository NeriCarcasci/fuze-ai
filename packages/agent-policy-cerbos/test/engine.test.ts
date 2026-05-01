import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { runPolicyConformance } from '@fuze-ai/agent/conformance'
import type {
  AnyFuzeTool,
  Ctx,
  RetentionPolicy,
  ThreatBoundary,
} from '@fuze-ai/agent'
import {
  Ok,
  makePrincipalId,
  makeRunId,
  makeStepId,
  makeTenantId,
} from '@fuze-ai/agent'
import { CerbosCompatPolicyEngine } from '../src/engine.js'

const TB: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

const RET: RetentionPolicy = {
  id: 'test.v1',
  hashTtlDays: 30,
  fullContentTtlDays: 7,
  decisionTtlDays: 90,
}

const tool = (name: string): AnyFuzeTool => ({
  name,
  description: 'stub',
  input: z.object({}),
  output: z.object({}),
  threatBoundary: TB,
  retention: RET,
  dataClassification: 'public',
  run: async () => Ok({}),
})

const ctx = (tenant = 't-eu'): Ctx<unknown> => ({
  tenant: makeTenantId(tenant),
  principal: makePrincipalId('p-1'),
  runId: makeRunId('r-1'),
  stepId: makeStepId('s-1'),
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

const yamlAllowFor = (resource: string): string => `
apiVersion: api.cerbos.dev/v1
resourcePolicy:
  resource: ${resource}
  rules:
    - id: ${resource}.allow
      actions: [invoke]
      effect: EFFECT_ALLOW
`

const yamlDenyFor = (resource: string): string => `
apiVersion: api.cerbos.dev/v1
resourcePolicy:
  resource: ${resource}
  rules:
    - id: ${resource}.deny
      actions: [invoke]
      effect: EFFECT_DENY
`

const yamlApprovalFor = (resource: string): string => `
apiVersion: api.cerbos.dev/v1
resourcePolicy:
  resource: ${resource}
  rules:
    - id: ${resource}.approval
      actions: [invoke]
      effect: EFFECT_REQUIRES_APPROVAL
`

const yamlTenantGated = (resource: string, tenant: string): string => `
apiVersion: api.cerbos.dev/v1
resourcePolicy:
  resource: ${resource}
  rules:
    - id: ${resource}.eu-only
      actions: [invoke]
      effect: EFFECT_ALLOW
      condition:
        match:
          expr: P.attr.tenant == '${tenant}'
`

describe('CerbosCompatPolicyEngine', () => {
  it('emits allow for a matching unconditional rule', async () => {
    const engine = new CerbosCompatPolicyEngine([yamlAllowFor('echo')])
    const decision = await engine.evaluate({
      tool: tool('echo'),
      args: {},
      ctx: ctx(),
    })
    expect(decision.effect).toBe('allow')
    expect(decision.policyId).toBe('echo.allow')
  })

  it('emits deny for a matching deny rule', async () => {
    const engine = new CerbosCompatPolicyEngine([yamlDenyFor('echo')])
    const decision = await engine.evaluate({
      tool: tool('echo'),
      args: {},
      ctx: ctx(),
    })
    expect(decision.effect).toBe('deny')
    expect(decision.policyId).toBe('echo.deny')
  })

  it('emits requires-approval when the rule says so', async () => {
    const engine = new CerbosCompatPolicyEngine([yamlApprovalFor('echo')])
    const decision = await engine.evaluate({
      tool: tool('echo'),
      args: {},
      ctx: ctx(),
    })
    expect(decision.effect).toBe('requires-approval')
  })

  it('default-denies when no policy matches the resource', async () => {
    const engine = new CerbosCompatPolicyEngine([yamlAllowFor('other')])
    const decision = await engine.evaluate({
      tool: tool('echo'),
      args: {},
      ctx: ctx(),
    })
    expect(decision.effect).toBe('deny')
    expect(decision.policyId).toBe('fuze.default.deny')
  })

  it('filters by tenant via P.attr condition', async () => {
    const engine = new CerbosCompatPolicyEngine([
      yamlTenantGated('echo', 't-eu'),
    ])
    const allow = await engine.evaluate({
      tool: tool('echo'),
      args: {},
      ctx: ctx('t-eu'),
    })
    expect(allow.effect).toBe('allow')
    const deny = await engine.evaluate({
      tool: tool('echo'),
      args: {},
      ctx: ctx('t-us'),
    })
    expect(deny.effect).toBe('deny')
  })

  it('matches a wildcard resource policy', async () => {
    const wildcardYaml = `
apiVersion: api.cerbos.dev/v1
resourcePolicy:
  resource: "*"
  rules:
    - id: any.allow
      actions: [invoke]
      effect: EFFECT_ALLOW
`
    const engine = new CerbosCompatPolicyEngine([wildcardYaml])
    const decision = await engine.evaluate({
      tool: tool('anything'),
      args: {},
      ctx: ctx(),
    })
    expect(decision.effect).toBe('allow')
  })
})

runPolicyConformance('CerbosCompatPolicyEngine', {
  factoryWithRules: (toolName) =>
    new CerbosCompatPolicyEngine([yamlAllowFor(toolName)]),
  factoryDefaultDeny: () => new CerbosCompatPolicyEngine([]),
  factoryRequiringApproval: (toolName) =>
    new CerbosCompatPolicyEngine([yamlApprovalFor(toolName)]),
})
