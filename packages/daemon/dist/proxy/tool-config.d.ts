import type { ProxyToolsConfig } from './types.js';
export interface ResolvedToolConfig {
    /** Estimated USD cost per call. Default: 0.01. */
    estimatedCost: number;
    /** Whether this tool has side effects. Default: false. */
    sideEffect: boolean;
    /** Maximum number of calls per run. Default: Infinity. */
    maxCallsPerRun: number;
    /** Timeout in ms. Default: 30000. */
    timeout: number;
    /** Model identifier for actual cost calculation from response usage. */
    model?: string;
}
/**
 * Resolves per-tool configuration from `fuze.toml [proxy.tools]`.
 *
 * Priority: tool-specific config > [proxy.tools.default] > built-in defaults.
 */
export declare class ToolConfig {
    private readonly config;
    constructor(config?: ProxyToolsConfig);
    /**
     * Returns fully resolved config for a given tool name.
     */
    getToolConfig(toolName: string): ResolvedToolConfig;
    /**
     * Returns true if the tool is marked as having side effects.
     */
    isSideEffect(toolName: string): boolean;
}
//# sourceMappingURL=tool-config.d.ts.map