import type { ProxyToolsConfig, ToolRawConfig } from './types.js'

export interface ResolvedToolConfig {
  /** Estimated USD cost per call. Default: 0.01. */
  estimatedCost: number
  /** Whether this tool has side effects. Default: false. */
  sideEffect: boolean
  /** Maximum number of calls per run. Default: Infinity. */
  maxCallsPerRun: number
  /** Timeout in ms. Default: 30000. */
  timeout: number
  /** Model identifier for actual cost calculation from response usage. */
  model?: string
}

const BUILTIN_DEFAULTS: ResolvedToolConfig = {
  estimatedCost: 0.01,
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

  /**
   * Returns fully resolved config for a given tool name.
   */
  getToolConfig(toolName: string): ResolvedToolConfig {
    const raw = this.config[toolName] as Partial<ToolRawConfig> | undefined
    const defaults = this.config['default'] as Partial<ToolRawConfig> | undefined

    return {
      estimatedCost:
        raw?.estimated_cost
        ?? defaults?.estimated_cost
        ?? BUILTIN_DEFAULTS.estimatedCost,
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

  /**
   * Returns true if the tool is marked as having side effects.
   */
  isSideEffect(toolName: string): boolean {
    return this.getToolConfig(toolName).sideEffect
  }
}
