import type {
  WasmEffect,
  WasmEngine,
  WasmEngineFactory,
  WasmEngineFactoryInput,
  WasmEvaluation,
  WasmPrincipal,
  WasmResource,
} from './wasm-types.js'

export interface FakeWasmRule {
  readonly resource: string
  readonly principal?: string
  readonly tenant?: string
  readonly effect: WasmEffect
}

export interface FakeWasmEngineOptions {
  readonly rules: readonly FakeWasmRule[]
}

const ruleMatches = (
  rule: FakeWasmRule,
  principal: WasmPrincipal,
  resource: WasmResource,
): boolean => {
  if (rule.resource !== resource.kind && rule.resource !== '*') return false
  if (rule.principal !== undefined && rule.principal !== principal.id) return false
  if (rule.tenant !== undefined && rule.tenant !== principal.attr['tenant']) return false
  return true
}

export class FakeWasmEngine implements WasmEngine {
  readonly evaluations: Array<{
    principal: WasmPrincipal
    resource: WasmResource
    actions: readonly string[]
  }> = []

  private readonly rules: readonly FakeWasmRule[]

  constructor(opts: FakeWasmEngineOptions) {
    this.rules = opts.rules
  }

  async evaluate(
    principal: WasmPrincipal,
    resource: WasmResource,
    actions: readonly string[],
  ): Promise<WasmEvaluation> {
    this.evaluations.push({ principal, resource, actions })
    const match = this.rules.find((r) => ruleMatches(r, principal, resource))
    const decided: Record<string, WasmEffect> = {}
    for (const action of actions) {
      decided[action] = match ? match.effect : 'EFFECT_DENY'
    }
    return { actions: decided }
  }
}

export interface FakeWasmEngineFactoryOptions {
  readonly rules?: readonly FakeWasmRule[]
}

export class FakeWasmEngineFactory implements WasmEngineFactory {
  readonly created: FakeWasmEngine[] = []
  readonly inputs: WasmEngineFactoryInput[] = []
  private readonly rules: readonly FakeWasmRule[]

  constructor(opts: FakeWasmEngineFactoryOptions = {}) {
    this.rules = opts.rules ?? []
  }

  async create(input: WasmEngineFactoryInput): Promise<WasmEngine> {
    this.inputs.push(input)
    const engine = new FakeWasmEngine({ rules: this.rules })
    this.created.push(engine)
    return engine
  }
}
