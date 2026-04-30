import type { FuzeConfig } from './types.js'
import { ConfigLoader } from './config-loader.js'
import { createService } from './services/index.js'
import type { FuzeService } from './services/index.js'

let _globalConfig: FuzeConfig = {}
let _configLoaded = false
let _service: FuzeService | null = null

function fireAndForget(promise: Promise<unknown>): void {
  promise.catch(() => undefined)
}

function mergeOptional<T extends object>(base: T | undefined, override: T | undefined): T | undefined {
  if (!base && !override) return undefined
  return { ...(base ?? {}), ...(override ?? {}) } as T
}

function mergeConfigs(base: FuzeConfig, override: FuzeConfig): FuzeConfig {
  return {
    ...base,
    ...override,
    defaults: mergeOptional(base.defaults, override.defaults),
    loopDetection: mergeOptional(base.loopDetection, override.loopDetection),
    daemon: mergeOptional(base.daemon, override.daemon),
    cloud: mergeOptional(base.cloud, override.cloud),
    project: mergeOptional(base.project, override.project),
    usageExtractor: override.usageExtractor ?? base.usageExtractor,
  }
}

export function ensureConfig(): FuzeConfig {
  if (!_configLoaded) {
    try {
      _globalConfig = mergeConfigs(ConfigLoader.load(), _globalConfig)
    } catch {
      // fuze.toml missing or invalid — fall through with empty config
    }
    _configLoaded = true
  }
  return _globalConfig
}

export function getOrCreateService(config: FuzeConfig): FuzeService {
  if (!_service) {
    _service = createService(config)
    fireAndForget(_service.connect())
  }
  return _service
}

export function applyConfigure(config: FuzeConfig): void {
  _globalConfig = mergeConfigs(_globalConfig, config)
  _configLoaded = false
  if (_service) {
    fireAndForget(_service.disconnect())
    _service = null
  }
}

export function applyResetConfig(): void {
  _globalConfig = {}
  _configLoaded = false
  if (_service) {
    fireAndForget(_service.disconnect())
    _service = null
  }
}
