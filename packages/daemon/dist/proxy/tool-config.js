const BUILTIN_DEFAULTS = {
    estimatedCost: 0.01,
    sideEffect: false,
    maxCallsPerRun: Infinity,
    timeout: 30_000,
    model: undefined,
};
/**
 * Resolves per-tool configuration from `fuze.toml [proxy.tools]`.
 *
 * Priority: tool-specific config > [proxy.tools.default] > built-in defaults.
 */
export class ToolConfig {
    config;
    constructor(config = {}) {
        this.config = config;
    }
    /**
     * Returns fully resolved config for a given tool name.
     */
    getToolConfig(toolName) {
        const raw = this.config[toolName];
        const defaults = this.config['default'];
        return {
            estimatedCost: raw?.estimated_cost
                ?? defaults?.estimated_cost
                ?? BUILTIN_DEFAULTS.estimatedCost,
            sideEffect: raw?.side_effect
                ?? defaults?.side_effect
                ?? BUILTIN_DEFAULTS.sideEffect,
            maxCallsPerRun: raw?.max_calls_per_run
                ?? defaults?.max_calls_per_run
                ?? BUILTIN_DEFAULTS.maxCallsPerRun,
            timeout: raw?.timeout
                ?? defaults?.timeout
                ?? BUILTIN_DEFAULTS.timeout,
            model: raw?.model
                ?? defaults?.model
                ?? BUILTIN_DEFAULTS.model,
        };
    }
    /**
     * Returns true if the tool is marked as having side effects.
     */
    isSideEffect(toolName) {
        return this.getToolConfig(toolName).sideEffect;
    }
}
//# sourceMappingURL=tool-config.js.map