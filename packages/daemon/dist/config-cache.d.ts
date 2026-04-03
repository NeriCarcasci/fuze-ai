import type { ToolConfig } from './protocol.js';
export declare class ConfigCache {
    private readonly db;
    constructor(storagePath: string);
    init(): void;
    /**
     * Replace all tool configs for a project with the provided map.
     * Used by ApiSync when a fresh /v1/tools/config response arrives.
     */
    setToolConfigs(projectId: string, tools: Record<string, ToolConfig>): void;
    /**
     * Upsert a single tool config (used by register_tools for local-only defaults).
     */
    upsertToolConfig(projectId: string, toolName: string, cfg: ToolConfig): void;
    getToolConfig(toolName: string): ToolConfig | null;
    getAllToolConfigs(): Record<string, ToolConfig>;
    getSyncState(key: string): string | null;
    setSyncState(key: string, value: string): void;
    close(): void;
}
//# sourceMappingURL=config-cache.d.ts.map