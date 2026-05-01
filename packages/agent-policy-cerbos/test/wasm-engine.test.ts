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
import { CerbosWasmPolicyEngine } from '../src/wasm-engine.js'
import { FakeWasmEngineFactory, type FakeWasmRule } from '../src/fake-wasm.js'
import { CerbosWasmConfigError } from '../src/wasm-types.js'

const TB: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

const RET: RetentionPolicy = {
  id: 'wasm.v1',
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

const stubBundle = new Uint8Array([0x00, 0x61, 0x73, 0x6d])

const allowFor = (resource: string): readonly FakeWasmRule[] => [
  { resource, effect: 'EFFECT_ALLOW' },
]

const denyFor = (resource: string): readonly FakeWasmRule[] => [
  { resource, effect: 'EFFECT_DENY' },
]

const approvalFor = (resource: string): readonly FakeWasmRule[] => [
  { resource, effect: 'EFFECT_REQUIRES_APPROVAL' },
]

describe('CerbosWasmPolicyEngine', () => {
  it('maps EFFECT_ALLOW to allow', async () => {
    const engine = new CerbosWasmPolicyEngine({
      factory: new FakeWasmEngineFactory({ rules: allowFor('echo') }),
      bundleBytes: stubBundle,
    })
    const decision = await engine.evaluate({
      tool: tool('echo'),
      args: {},
      ctx: ctx(),
    })
    expect(decision.effect).toBe('allow')
    expect(decision.policyId).toBe('cerbos.wasm.echo.EFFECT_ALLOW')
  })

  it('maps EFFECT_DENY to deny', async () => {
    const engine = new CerbosWasmPolicyEngine({
      factory: new FakeWasmEngineFactory({ rules: denyFor('echo') }),
      bundleBytes: stubBundle,
    })
    const decision = await engine.evaluate({
      tool: tool('echo'),
      args: {},
      ctx: ctx(),
    })
    expect(decision.effect).toBe('deny')
  })

  it('maps EFFECT_REQUIRES_APPROVAL to requires-approval', async () => {
    const engine = new CerbosWasmPolicyEngine({
      factory: new FakeWasmEngineFactory({ rules: approvalFor('echo') }),
      bundleBytes: stubBundle,
    })
    const decision = await engine.evaluate({
      tool: tool('echo'),
      args: {},
      ctx: ctx(),
    })
    expect(decision.effect).toBe('requires-approval')
  })

  it('default-denies when no fake rule matches the resource', async () => {
    const engine = new CerbosWasmPolicyEngine({
      factory: new FakeWasmEngineFactory({ rules: allowFor('other') }),
      bundleBytes: stubBundle,
    })
    const decision = await engine.evaluate({
      tool: tool('echo'),
      args: {},
      ctx: ctx(),
    })
    expect(decision.effect).toBe('deny')
  })

  it('matches a wildcard resource rule', async () => {
    const engine = new CerbosWasmPolicyEngine({
      factory: new FakeWasmEngineFactory({
        rules: [{ resource: '*', effect: 'EFFECT_ALLOW' }],
      }),
      bundleBytes: stubBundle,
    })
    const decision = await engine.evaluate({
      tool: tool('anything'),
      args: {},
      ctx: ctx(),
    })
    expect(decision.effect).toBe('allow')
  })

  it('caches the wasm engine across evaluations (one factory create)', async () => {
    const factory = new FakeWasmEngineFactory({ rules: allowFor('echo') })
    const engine = new CerbosWasmPolicyEngine({
      factory,
      bundleBytes: stubBundle,
    })
    await engine.evaluate({ tool: tool('echo'), args: {}, ctx: ctx() })
    await engine.evaluate({ tool: tool('echo'), args: {}, ctx: ctx() })
    expect(factory.created.length).toBe(1)
    expect(factory.created[0]?.evaluations.length).toBe(2)
  })

  it('passes tenant attr through to the wasm engine principal', async () => {
    const factory = new FakeWasmEngineFactory({
      rules: [{ resource: 'echo', tenant: 't-eu', effect: 'EFFECT_ALLOW' }],
    })
    const engine = new CerbosWasmPolicyEngine({
      factory,
      bundleBytes: stubBundle,
    })
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
    const evals = factory.created[0]?.evaluations ?? []
    expect(evals[0]?.principal.attr['tenant']).toBe('t-eu')
    expect(evals[1]?.principal.attr['tenant']).toBe('t-us')
  })

  it('forwards bundleBytes through factory input', async () => {
    const factory = new FakeWasmEngineFactory({ rules: allowFor('echo') })
    const engine = new CerbosWasmPolicyEngine({ factory, bundleBytes: stubBundle })
    await engine.evaluate({ tool: tool('echo'), args: {}, ctx: ctx() })
    expect(factory.inputs[0]?.bundleBytes).toBe(stubBundle)
    expect(factory.inputs[0]?.bundlePath).toBeUndefined()
  })

  it('forwards bundlePath through factory input', async () => {
    const factory = new FakeWasmEngineFactory({ rules: allowFor('echo') })
    const engine = new CerbosWasmPolicyEngine({ factory, bundlePath: '/tmp/x.wasm' })
    await engine.evaluate({ tool: tool('echo'), args: {}, ctx: ctx() })
    expect(factory.inputs[0]?.bundlePath).toBe('/tmp/x.wasm')
    expect(factory.inputs[0]?.bundleBytes).toBeUndefined()
  })

  it('throws when neither bundlePath nor bundleBytes is provided', () => {
    expect(
      () =>
        new CerbosWasmPolicyEngine({
          factory: new FakeWasmEngineFactory(),
        }),
    ).toThrow(CerbosWasmConfigError)
  })
})

runPolicyConformance('CerbosWasmPolicyEngine', {
  factoryWithRules: (toolName) =>
    new CerbosWasmPolicyEngine({
      factory: new FakeWasmEngineFactory({ rules: allowFor(toolName) }),
      bundleBytes: stubBundle,
    }),
  factoryDefaultDeny: () =>
    new CerbosWasmPolicyEngine({
      factory: new FakeWasmEngineFactory(),
      bundleBytes: stubBundle,
    }),
  factoryRequiringApproval: (toolName) =>
    new CerbosWasmPolicyEngine({
      factory: new FakeWasmEngineFactory({ rules: approvalFor(toolName) }),
      bundleBytes: stubBundle,
    }),
})
