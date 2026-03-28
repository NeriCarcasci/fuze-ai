import type { FuzeConfig, GuardOptions, ResolvedOptions } from './types.js';
/**
 * Loads Fuze configuration from fuze.toml and merges with defaults and per-function options.
 */
export declare class ConfigLoader {
    /**
     * Load configuration from a fuze.toml file.
     * Returns built-in defaults if the file does not exist.
     * @param path - Path to fuze.toml. Defaults to './fuze.toml' in the current working directory.
     * @returns The parsed Fuze configuration.
     * @throws Error with file path if the TOML is invalid.
     */
    static load(path?: string): FuzeConfig;
    /**
     * Merge project config (from fuze.toml) with per-function guard options.
     * Priority: guardOptions > projectConfig > DEFAULTS.
     * @param projectConfig - Configuration loaded from fuze.toml.
     * @param guardOptions - Per-function options passed to guard().
     * @returns Fully resolved options.
     */
    static merge(projectConfig: FuzeConfig, guardOptions?: GuardOptions): ResolvedOptions;
}
//# sourceMappingURL=config-loader.d.ts.map