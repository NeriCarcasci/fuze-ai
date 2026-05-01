import { readFile } from 'node:fs/promises'
import {
  CerbosEmbeddedNotInstalledError,
  CerbosWasmConfigError,
  type WasmEffect,
  type WasmEngine,
  type WasmEngineFactory,
  type WasmEngineFactoryInput,
  type WasmEvaluation,
  type WasmPrincipal,
  type WasmResource,
} from './wasm-types.js'

interface CerbosEmbeddedActionEffectMap {
  readonly [action: string]: string
}

interface CerbosEmbeddedCheckResource {
  readonly resource: { readonly kind: string; readonly id: string; readonly attr?: Record<string, unknown> }
  readonly actions: readonly string[]
}

interface CerbosEmbeddedCheckRequest {
  readonly principal: { readonly id: string; readonly roles?: readonly string[]; readonly attr?: Record<string, unknown> }
  readonly resource: CerbosEmbeddedCheckResource['resource']
  readonly actions: readonly string[]
}

interface CerbosEmbeddedResponse {
  isAllowed(action: string): boolean
  readonly actions?: CerbosEmbeddedActionEffectMap
}

interface CerbosEmbeddedClient {
  checkResource(req: CerbosEmbeddedCheckRequest): Promise<CerbosEmbeddedResponse>
}

interface CerbosEmbeddedModule {
  readonly Embedded: new (bundle: Uint8Array | ArrayBuffer) => CerbosEmbeddedClient
}

const loadEmbeddedModule = async (): Promise<CerbosEmbeddedModule> => {
  try {
    const mod = (await import(
      /* @vite-ignore */ '@cerbos/embedded' as string
    )) as CerbosEmbeddedModule
    return mod
  } catch {
    throw new CerbosEmbeddedNotInstalledError()
  }
}

const normalizeEffect = (raw: string | undefined, isAllowed: boolean): WasmEffect => {
  if (raw === 'EFFECT_ALLOW' || raw === 'EFFECT_DENY' || raw === 'EFFECT_REQUIRES_APPROVAL') {
    return raw
  }
  return isAllowed ? 'EFFECT_ALLOW' : 'EFFECT_DENY'
}

class RealWasmEngine implements WasmEngine {
  constructor(private readonly client: CerbosEmbeddedClient) {}

  async evaluate(
    principal: WasmPrincipal,
    resource: WasmResource,
    actions: readonly string[],
  ): Promise<WasmEvaluation> {
    const principalReq: { id: string; roles?: readonly string[]; attr?: Record<string, unknown> } = {
      id: principal.id,
      attr: { ...principal.attr },
    }
    if (principal.roles !== undefined) principalReq.roles = principal.roles
    const response = await this.client.checkResource({
      principal: principalReq,
      resource: {
        kind: resource.kind,
        id: resource.id ?? resource.kind,
        attr: { ...resource.attr },
      },
      actions,
    })
    const decided: Record<string, WasmEffect> = {}
    for (const action of actions) {
      decided[action] = normalizeEffect(response.actions?.[action], response.isAllowed(action))
    }
    return { actions: decided }
  }
}

const resolveBundle = async (input: WasmEngineFactoryInput): Promise<Uint8Array> => {
  if (input.bundleBytes !== undefined) return input.bundleBytes
  if (input.bundlePath !== undefined) return new Uint8Array(await readFile(input.bundlePath))
  throw new CerbosWasmConfigError(
    'RealWasmEngineFactory.create requires bundleBytes or bundlePath',
  )
}

export class RealWasmEngineFactory implements WasmEngineFactory {
  async create(input: WasmEngineFactoryInput): Promise<WasmEngine> {
    const bundle = await resolveBundle(input)
    const mod = await loadEmbeddedModule()
    const client = new mod.Embedded(bundle)
    return new RealWasmEngine(client)
  }
}
