export type WasmEffect =
  | 'EFFECT_ALLOW'
  | 'EFFECT_DENY'
  | 'EFFECT_REQUIRES_APPROVAL'

export interface WasmPrincipal {
  readonly id: string
  readonly roles?: readonly string[]
  readonly attr: Readonly<Record<string, unknown>>
}

export interface WasmResource {
  readonly kind: string
  readonly id?: string
  readonly attr: Readonly<Record<string, unknown>>
}

export interface WasmEvaluation {
  readonly actions: Readonly<Record<string, WasmEffect>>
}

export interface WasmEngine {
  evaluate(
    principal: WasmPrincipal,
    resource: WasmResource,
    actions: readonly string[],
  ): Promise<WasmEvaluation>
}

export interface WasmEngineFactoryInput {
  readonly bundleBytes?: Uint8Array
  readonly bundlePath?: string
}

export interface WasmEngineFactory {
  create(input: WasmEngineFactoryInput): Promise<WasmEngine>
}

export class CerbosEmbeddedNotInstalledError extends Error {
  constructor() {
    super(
      '@cerbos/embedded is not installed. Add it as an optional dependency: `npm install @cerbos/embedded`. The WASM bundle is produced by the Cerbos CLI: `cerbos compile --output-bundle bundle.wasm policies/`.',
    )
    this.name = 'CerbosEmbeddedNotInstalledError'
  }
}

export class CerbosWasmConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CerbosWasmConfigError'
  }
}
