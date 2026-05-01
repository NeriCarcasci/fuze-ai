import type {
  PolicyDecision,
  PolicyEffect,
  PolicyEngine,
  PolicyEvaluateInput,
} from '@fuze-ai/agent'
import {
  CerbosWasmConfigError,
  type WasmEffect,
  type WasmEngine,
  type WasmEngineFactory,
  type WasmEngineFactoryInput,
  type WasmPrincipal,
  type WasmResource,
} from './wasm-types.js'

const INVOKE_ACTION = 'invoke'

const mapEffect = (e: WasmEffect): PolicyEffect => {
  switch (e) {
    case 'EFFECT_ALLOW':
      return 'allow'
    case 'EFFECT_DENY':
      return 'deny'
    case 'EFFECT_REQUIRES_APPROVAL':
      return 'requires-approval'
  }
}

const buildPrincipal = (input: PolicyEvaluateInput): WasmPrincipal => ({
  id: String(input.ctx.principal),
  attr: {
    tenant: String(input.ctx.tenant),
    runId: String(input.ctx.runId),
    stepId: String(input.ctx.stepId),
  },
})

const buildResource = (input: PolicyEvaluateInput): WasmResource => {
  const args =
    typeof input.args === 'object' && input.args !== null
      ? (input.args as Record<string, unknown>)
      : {}
  return {
    kind: input.tool.name,
    id: input.tool.name,
    attr: {
      ...args,
      name: input.tool.name,
      dataClassification: input.tool.dataClassification,
    },
  }
}

export interface CerbosWasmPolicyEngineOptions {
  readonly factory: WasmEngineFactory
  readonly bundlePath?: string
  readonly bundleBytes?: Uint8Array
}

export class CerbosWasmPolicyEngine implements PolicyEngine {
  private readonly factory: WasmEngineFactory
  private readonly factoryInput: WasmEngineFactoryInput
  private engine: Promise<WasmEngine> | undefined

  constructor(opts: CerbosWasmPolicyEngineOptions) {
    if (opts.bundleBytes === undefined && opts.bundlePath === undefined) {
      throw new CerbosWasmConfigError(
        'CerbosWasmPolicyEngine requires either bundleBytes or bundlePath',
      )
    }
    this.factory = opts.factory
    const input: { bundleBytes?: Uint8Array; bundlePath?: string } = {}
    if (opts.bundleBytes !== undefined) input.bundleBytes = opts.bundleBytes
    if (opts.bundlePath !== undefined) input.bundlePath = opts.bundlePath
    this.factoryInput = input
  }

  async evaluate(input: PolicyEvaluateInput): Promise<PolicyDecision> {
    const engine = await this.getEngine()
    const principal = buildPrincipal(input)
    const resource = buildResource(input)
    const result = await engine.evaluate(principal, resource, [INVOKE_ACTION])
    const effect = result.actions[INVOKE_ACTION]
    if (effect === undefined) {
      return {
        effect: 'deny',
        policyId: 'fuze.default.deny',
        reason: 'wasm engine returned no decision for invoke (default-deny)',
      }
    }
    const policyId = `cerbos.wasm.${resource.kind}.${effect}`
    return {
      effect: mapEffect(effect),
      policyId,
      reason: `cerbos wasm bundle decided ${effect}`,
    }
  }

  private getEngine(): Promise<WasmEngine> {
    if (this.engine === undefined) {
      this.engine = this.factory.create(this.factoryInput)
    }
    return this.engine
  }
}
