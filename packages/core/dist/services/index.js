import { ApiService } from './api-service.js';
import { DaemonService } from './daemon-service.js';
import { NoopService } from './noop-service.js';
export { ApiService } from './api-service.js';
export { DaemonService } from './daemon-service.js';
export { NoopService } from './noop-service.js';
/**
 * Creates the appropriate FuzeService based on config.
 * Priority: ApiService (cloud key) > DaemonService (local daemon) > NoopService (standalone).
 */
export function createService(config) {
    const apiKey = config.cloud?.apiKey ?? process.env['FUZE_API_KEY'];
    if (apiKey)
        return new ApiService(apiKey, config.cloud?.endpoint);
    if (config.daemon?.enabled)
        return new DaemonService(config.daemon?.socketPath);
    return new NoopService();
}
//# sourceMappingURL=index.js.map