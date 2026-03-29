import type { DaemonConfig } from './types.js';
/**
 * Returns the appropriate IPC path for the current platform.
 * Windows uses named pipes; Unix uses a socket file in /tmp.
 */
export declare function defaultSocketPath(): string;
/**
 * Load daemon config from a fuze.toml file (if present) and merge with defaults.
 *
 * The `[daemon]` section is used. All fields are optional; missing fields
 * fall back to DEFAULTS.
 *
 * @param configPath - Explicit path to fuze.toml. Defaults to searching
 *   cwd → home directory.
 */
export declare function loadDaemonConfig(configPath?: string): DaemonConfig;
//# sourceMappingURL=config.d.ts.map