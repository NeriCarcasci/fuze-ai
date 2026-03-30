import type { FuzeService, ToolRegistration, ToolConfig, StepCheckData, StepEndData, GuardEventData } from './types.js';
/**
 * ApiService — talks to api.fuze-ai.tech (or custom endpoint) over HTTPS.
 *
 * Config: fetches tool configs at connect() time and every 30 seconds.
 * getToolConfig() is synchronous — reads from an in-memory Map.
 *
 * Telemetry: same batched HTTPS strategy as CloudTransport.
 * Step checks use a 50ms timeout, falling back to 'proceed'.
 */
export declare class ApiService implements FuzeService {
    private readonly apiKey;
    private readonly endpoint;
    private readonly _configCache;
    private _buffer;
    private _flushTimer;
    private _refreshTimer;
    private _connected;
    constructor(apiKey: string, endpoint?: string);
    connect(): Promise<boolean>;
    disconnect(): void;
    isConnected(): boolean;
    registerTools(projectId: string, tools: ToolRegistration[]): Promise<void>;
    getToolConfig(toolName: string): ToolConfig | null;
    refreshConfig(): Promise<void>;
    sendRunStart(runId: string, agentId: string, config: object): Promise<void>;
    sendStepStart(runId: string, step: StepCheckData): Promise<'proceed' | 'kill' | 'pause'>;
    sendStepEnd(runId: string, stepId: string, data: StepEndData): Promise<void>;
    sendGuardEvent(runId: string, event: GuardEventData): Promise<void>;
    sendRunEnd(runId: string, status: string, totalCost: number): Promise<void>;
    private _enqueue;
    private _flush;
}
//# sourceMappingURL=api-service.d.ts.map