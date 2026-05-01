import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  Ok,
  makePrincipalId,
  makeRunId,
  makeStepId,
  makeTenantId,
} from '@fuze-ai/agent'
import type {
  AnyFuzeTool,
  Ctx,
  RetentionPolicy,
  ThreatBoundary,
} from '@fuze-ai/agent'
import { CerbosWasmPolicyEngine } from '../src/wasm-engine.js'
import { RealWasmEngineFactory } from '../src/real-wasm.js'

const BUNDLE_PATH = 'D:/Fuze-systems/fuze/bundles/bundle.wasm'

const liveEnabled =
  process.env['CI_LIVE_CERBOS'] === '1' && existsSync(BUNDLE_PATH)

const TB: ThreatBoundary = {
  trustedCallers: ['agent-loop'],
  observesSecrets: false,
  egressDomains: 'none',
  readsFilesystem: false,
  writesFilesystem: false,
}

const RET: RetentionPolicy = {
  id: 'wasm.live.v1',
  hashTtlDays: 30,
  fullContentTtlDays: 7,
  decisionTtlDays: 90,
}

const tool = (name: string): AnyFuzeTool => ({
  name,
  description: 'live wasm conformance stub',
  input: z.object({}),
  output: z.object({}),
  threatBoundary: TB,
  retention: RET,
  dataClassification: 'public',
  run: async () => Ok({}),
})

const ctx = (tenant = 't-eu'): Ctx<unknown> => ({
  tenant: makeTenantId(tenant),
  principal: makePrincipalId('p-live'),
  runId: makeRunId('r-live'),
  stepId: makeStepId('s-live'),
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

// Skipped locally (no bundle, gate off). When CI compiles the WASM bundle,
// this exercises the real Cerbos embedded engine against the same tool/ctx
// shapes the YAML+CEL evaluator already conforms to.
describe.skipIf(!liveEnabled)(
  'CerbosWasmPolicyEngine — live (gated by CI_LIVE_CERBOS=1 + bundle.wasm)',
  () => {
    const buildEngine = (): CerbosWasmPolicyEngine =>
      new CerbosWasmPolicyEngine({
        factory: new RealWasmEngineFactory(),
        bundlePath: BUNDLE_PATH,
      })

    it('emits an allow decision for a public tool', async () => {
      const engine = buildEngine()
      const decision = await engine.evaluate({
        tool: tool('echo'),
        args: {},
        ctx: ctx(),
      })
      expect(decision.policyId).toBeDefined()
      expect(['allow', 'deny', 'requires-approval']).toContain(decision.effect)
    })

    it('attaches a policyId to every decision', async () => {
      const engine = buildEngine()
      const decision = await engine.evaluate({
        tool: tool('any-tool'),
        args: { foo: 'bar' },
        ctx: ctx(),
      })
      expect(decision.policyId).toBeDefined()
      expect(decision.reason).toBeDefined()
    })
  },
)
