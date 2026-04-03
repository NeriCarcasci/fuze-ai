/**
 * ApiSync — pulls tool configs from the Fuze cloud API every 30 seconds
 * and writes them into the local ConfigCache. Active only when FUZE_API_KEY
 * is set in the environment or passed explicitly.
 */
import type { ConfigCache } from './config-cache.js';
export declare class ApiSync {
    private readonly apiKey;
    private readonly endpoint;
    private readonly configCache;
    private readonly projectId;
    private timer;
    constructor(apiKey: string, endpoint: string, configCache: ConfigCache, projectId: string);
    /** Start the sync loop. Initial pull runs immediately. */
    start(): void;
    stop(): void;
    private _pull;
}
//# sourceMappingURL=api-sync.d.ts.map