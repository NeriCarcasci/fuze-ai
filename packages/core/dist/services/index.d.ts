import type { FuzeConfig } from '../types.js';
export type { FuzeService, ToolRegistration, ToolConfig, StepCheckData, StepEndData, GuardEventData } from './types.js';
export { ApiService } from './api-service.js';
export { DaemonService } from './daemon-service.js';
export { NoopService } from './noop-service.js';
/**
 * Creates the appropriate FuzeService based on config.
 * Priority: ApiService (cloud key) > DaemonService (local daemon) > NoopService (standalone).
 */
export declare function createService(config: FuzeConfig): import('./types.js').FuzeService;
//# sourceMappingURL=index.d.ts.map