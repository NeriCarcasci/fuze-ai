import type { ProxyToolsConfig, ToolRawConfig } from './types.js'

export interface ResolvedToolConfig {
  /** Estimated tokens per call. Default: 0. */
  estimatedTokens: number
  /** Whether this tool has side effects. Default: false. */
  sideEffect: boolean
  /** Maximum number of calls per run. Default: Infinity. */
  maxCallsPerRun: number
  /** Timeout in ms. Default: 30000. */
  timeout: number
  /** Model identifier for usage accounting from response payloads. */
  model?: string
}

const BUILTIN_DEFAULTS: ResolvedToolConfig = {
  estimatedTokens: 0,
  sideEffect: false,
  maxCallsPerRun: Infinity,
  timeout: 30_000,
  model: undefined,
}

/**
 * Resolves per-tool configuration from `fuze.toml [proxy.tools]`.
 *
 * Priority: tool-specific config > [proxy.tools.default] > built-in defaults.
 */
export class ToolConfig {
  constructor(private readonly config: ProxyToolsConfig = {}) {}

  getToolConfig(toolName: string): ResolvedToolConfig {
    const raw = this.config[toolName] as Partial<ToolRawConfig> | undefined
    const defaults = this.config['default'] as Partial<ToolRawConfig> | undefined

    return {
      estimatedTokens:
        raw?.estimated_tokens
        ?? defaults?.estimated_tokens
        ?? BUILTIN_DEFAULTS.estimatedTokens,
      sideEffect:
        raw?.side_effect
        ?? defaults?.side_effect
        ?? BUILTIN_DEFAULTS.sideEffect,
      maxCallsPerRun:
        raw?.max_calls_per_run
        ?? defaults?.max_calls_per_run
        ?? BUILTIN_DEFAULTS.maxCallsPerRun,
      timeout:
        raw?.timeout
        ?? defaults?.timeout
        ?? BUILTIN_DEFAULTS.timeout,
      model:
        raw?.model
        ?? defaults?.model
        ?? BUILTIN_DEFAULTS.model,
    }
  }

  isSideEffect(toolName: string): boolean {
    return this.getToolConfig(toolName).sideEffect
  }
}
