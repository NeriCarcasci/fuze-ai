const SYNC_INTERVAL_MS = 30_000;
const FETCH_TIMEOUT_MS = 10_000;
export class ApiSync {
    apiKey;
    endpoint;
    configCache;
    projectId;
    timer = null;
    constructor(apiKey, endpoint, configCache, projectId) {
        this.apiKey = apiKey;
        this.endpoint = endpoint;
        this.configCache = configCache;
        this.projectId = projectId;
    }
    /** Start the sync loop. Initial pull runs immediately. */
    start() {
        void this._pull();
        this.timer = setInterval(() => void this._pull(), SYNC_INTERVAL_MS);
        this.timer.unref();
    }
    stop() {
        if (this.timer !== null) {
            clearInterval(this.timer);
            this.timer = null;
        }
    }
    async _pull() {
        try {
            const res = await fetch(`${this.endpoint}/v1/tools/config`, {
                headers: { 'x-api-key': this.apiKey },
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            });
            if (!res.ok)
                return;
            const body = await res.json();
            if (body.tools && typeof body.tools === 'object') {
                this.configCache.setToolConfigs(this.projectId, body.tools);
                this.configCache.setSyncState('last_synced_at', new Date().toISOString());
            }
        }
        catch {
            // Network error or timeout — keep serving the stale cache
        }
    }
}
//# sourceMappingURL=api-sync.js.map